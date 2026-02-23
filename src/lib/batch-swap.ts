// src/lib/batch-swap.ts
//
// ARSITEKTUR:
//   simulateBatchSwap → cek route tiap token (processable vs skip), TIDAK build calls
//   executeBatchSwap  → fetch FRESH routes saat confirm, build calls, kirim 1 tx
//
// Kenapa dipisah:
//   - DEX quote punya validity window pendek (~30-90 detik)
//   - Kalau pakai calls dari simulation, kemungkinan expired saat execute
//   - Gas estimate hanya untuk UI (static heuristic), tidak simulate onchain
//   - estimateContractGas dengan DEX calldata = pasti revert (deadline, nonce, dll)

import { encodeFunctionData, erc20Abi, maxUint256, type Address } from "viem";
import { getSmartAccountClient } from "~/lib/smart-account";

const WETH             = "0x4200000000000000000000000000000000000006" as Address;
const FEE_RECIPIENT    = "0x4fba95e4772be6d37a0c931D00570Fe2c9675524";
const FEE_PERCENT_STR  = "0.05";
const PLATFORM_FEE_BPS = 500n;
const BPS_DENOM        = 10_000n;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SwapCandidate {
  token:   Address;
  symbol:  string;
  balance: bigint;
  route?: {
    to:              Address;
    data:            `0x${string}`;
    value:           bigint;
    approvalSpender: Address;
    agg:             string;
    grossWethOut:    bigint;
  };
  status:  "ok" | "skip";
  reason?: string;
  netWethOut:   bigint;
  estimatedFee: bigint;
}

export interface SimulationResult {
  // ⚠️ Tidak ada "calls" di sini — fresh routes di-fetch saat execute
  candidates:  SwapCandidate[];
  processable: SwapCandidate[];
  skipped:     SwapCandidate[];
  totalNetWeth: bigint;
  totalFee:     bigint;
  // Static heuristic — hanya untuk UI display, BUKAN simulate onchain
  gasEstimate: {
    callGasLimit: bigint;
  };
}

// ── Fetch 1 route ─────────────────────────────────────────────────────────────
// vault = address yang akan execute → wajib jadi taker/sender di semua aggregator
async function fetchRoute(
  token:   Address,
  balance: bigint,
  vault:   Address,
  chainId: number
): Promise<SwapCandidate["route"] | null> {

  console.log(`[fetchRoute] token=${token} balance=${balance} vault=${vault}`);

  // 1. 0x (dengan LI.FI fallback di backend)
  // ⚠️ Tidak pakai buyTokenPercentageFee — bisa corrupt buyAmount & trigger revert
  // Fee 5% platform hanya untuk display di UI, tidak di-embed ke DEX calldata
  try {
    const params = new URLSearchParams({
      chainId:            String(chainId),
      sellToken:          token,
      buyToken:           WETH,
      sellAmount:         balance.toString(),
      taker:              vault,
      slippagePercentage: "0.5",  // 50% sementara untuk debug; turunkan ke 0.15 setelah ok
    });
    const res = await fetch(`/api/0x/quote?${params}`);
    if (res.ok) {
      const q = await res.json();
      console.log(`[fetchRoute] 0x resp:`, { error: q?.error, to: q?.transaction?.to, buyAmount: q?.buyAmount, approvalAddress: q?.transaction?.approvalAddress });
      if (q?.transaction?.data && q?.transaction?.to && !q?.error) {
        const gross = BigInt(q.buyAmount || q.estimate?.toAmount || "0");
        if (gross > 0n) {
          return {
            to:              q.transaction.to as Address,
            data:            q.transaction.data as `0x${string}`,
            value:           BigInt(q.transaction.value || "0"),
            approvalSpender: (q.transaction.approvalAddress || q.transaction.to) as Address,
            agg:             q._source === "lifi" ? "LI.FI" : "0x",
            grossWethOut:    gross,
          };
        }
      }
    } else {
      const errText = await res.text().catch(() => "");
      console.warn(`[fetchRoute] 0x HTTP ${res.status}:`, errText.slice(0, 200));
    }
  } catch (e) {
    console.warn(`[fetchRoute] 0x exception:`, e);
  }

  // 2. KyberSwap fallback
  try {
    const rRes = await fetch(
      `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${token}&tokenOut=${WETH}&amountIn=${balance.toString()}`,
      { headers: { Accept: "application/json", "x-client-id": "nyawit" } }
    );
    if (!rRes.ok) return null;
    const rd = await rRes.json();
    if (!rd?.data?.routeSummary) return null;

    const bRes = await fetch(
      "https://aggregator-api.kyberswap.com/base/api/v1/route/build",
      {
        method:  "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-client-id": "nyawit" },
        body:    JSON.stringify({
          routeSummary:      rd.data.routeSummary,
          sender:            vault,
          recipient:         vault,
          slippageTolerance: 1500,
        }),
      }
    );
    if (!bRes.ok) return null;
    const bd = await bRes.json();
    if (!bd?.data?.data) return null;

    const gross = BigInt(rd.data.routeSummary.amountOut || "0");
    if (gross === 0n) return null;

    return {
      to:              bd.data.routerAddress as Address,
      data:            bd.data.data as `0x${string}`,
      value:           0n,
      approvalSpender: bd.data.routerAddress as Address,
      agg:             "KyberSwap",
      grossWethOut:    gross,
    };
  } catch {}

  return null;
}

// ── SIMULATE ──────────────────────────────────────────────────────────────────
// Hanya cek apakah route ada. Tidak build calls, tidak estimateContractGas.
// Gas estimate = static heuristic untuk UI display saja.
export async function simulateBatchSwap({
  walletClient,
  chainId,
  tokens,
}: {
  walletClient: any;
  chainId:      number;
  tokens: { address: Address; symbol: string; balance: bigint }[];
}): Promise<SimulationResult> {
  const client     = await getSmartAccountClient(walletClient);
  const vault      = client.account.address;
  const vaultLower = vault.toLowerCase();
  const zeroAddr   = "0x0000000000000000000000000000000000000000";

  const candidates: SwapCandidate[] = await Promise.all(
    tokens.map(async t => {
      if (t.balance === 0n) {
        return { token: t.address, symbol: t.symbol, balance: t.balance, status: "skip" as const, reason: "Zero balance", netWethOut: 0n, estimatedFee: 0n };
      }

      const route = await fetchRoute(t.address, t.balance, vault, chainId);

      if (!route) {
        return { token: t.address, symbol: t.symbol, balance: t.balance, status: "skip" as const, reason: "No route found", netWethOut: 0n, estimatedFee: 0n };
      }

      const spender = route.approvalSpender.toLowerCase();
      if (spender === vaultLower || spender === zeroAddr) {
        return { token: t.address, symbol: t.symbol, balance: t.balance, status: "skip" as const, reason: "Invalid spender", netWethOut: 0n, estimatedFee: 0n };
      }

      const fee    = (route.grossWethOut * PLATFORM_FEE_BPS) / BPS_DENOM;
      const netOut = route.grossWethOut - fee;

      return {
        token:    t.address,
        symbol:   t.symbol,
        balance:  t.balance,
        route,
        status:   "ok" as const,
        netWethOut:   netOut,
        estimatedFee: fee,
      };
    })
  );

  const processable = candidates.filter(c => c.status === "ok");
  const skipped     = candidates.filter(c => c.status === "skip");

  if (processable.length === 0) {
    throw new Error("No routes found for any selected token");
  }

  const totalNetWeth = processable.reduce((a, c) => a + c.netWethOut,   0n);
  const totalFee     = processable.reduce((a, c) => a + c.estimatedFee, 0n);

  // Static only — ~200k per approve+swap pair + 50k overhead
  const gasEstimate = {
    callGasLimit: BigInt(processable.length) * 200_000n + 50_000n,
  };

  return { candidates, processable, skipped, totalNetWeth, totalFee, gasEstimate };
}

// ── EXECUTE ───────────────────────────────────────────────────────────────────
// Fetch FRESH routes tepat saat user tekan Confirm.
// Input: list token yang PROCESSABLE dari simulation result.
export async function executeBatchSwap({
  walletClient,
  chainId,
  tokens,
}: {
  walletClient: any;
  chainId:      number;
  tokens: { address: Address; symbol: string; balance: bigint }[];
}) {
  const client     = await getSmartAccountClient(walletClient);
  const vault      = client.account.address;
  const vaultLower = vault.toLowerCase();
  const zeroAddr   = "0x0000000000000000000000000000000000000000";

  // Fresh routes
  const routeResults = await Promise.all(
    tokens.map(t => fetchRoute(t.address, t.balance, vault, chainId))
  );

  // Build calls: [approve1, swap1, approve2, swap2, ...]
  const calls: { to: Address; data: `0x${string}`; value: bigint }[] = [];
  const skippedAtExecute: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const r = routeResults[i];

    if (!r) {
      skippedAtExecute.push(t.symbol);
      console.warn(`[BatchSwap] no fresh route at execute for ${t.symbol}`);
      continue;
    }

    const spender = r.approvalSpender.toLowerCase();
    if (spender === vaultLower || spender === zeroAddr) {
      skippedAtExecute.push(t.symbol);
      continue;
    }

    // approve
    calls.push({
      to:    t.address,
      value: 0n,
      data:  encodeFunctionData({
        abi:          erc20Abi,
        functionName: "approve",
        args:         [r.approvalSpender, maxUint256],
      }),
    });
    // swap
    calls.push({ to: r.to, value: r.value, data: r.data });
  }

  if (calls.length === 0) {
    throw new Error(
      `All routes expired at execute time${skippedAtExecute.length ? ": " + skippedAtExecute.join(", ") : ""}`
    );
  }

  if (skippedAtExecute.length > 0) {
    console.warn("[BatchSwap] skipped at execute:", skippedAtExecute);
  }

  // Debug: log sebelum kirim
  console.log("[BatchSwap] execute calls:", calls.map((c, i) => ({
    index: i,
    to:    c.to,
    value: c.value.toString(),
    dataLen: c.data.length,
    type:  i % 2 === 0 ? "approve" : "swap",
  })));

  // 1 tx — semua approve+swap atomic
  const txHash  = await client.sendUserOperation({ calls });
  const receipt = await client.waitForUserOperationReceipt({ hash: txHash });

  return { receipt, txHash, skippedAtExecute };
}