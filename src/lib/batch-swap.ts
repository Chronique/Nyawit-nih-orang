// src/lib/batch-swap.ts
//
// ⚠ Swap pakai getDirectVaultClient (TIDAK sponsored) karena CDP Paymaster
// tidak bisa whitelist semua token ERC20 sembarang (approve ke random token = reject).
//
// Operasi lain (wrap/unwrap, morpho) tetap pakai getSmartAccountClient (sponsored).

import { encodeFunctionData, erc20Abi, type Address } from "viem";
import { getDirectVaultClient } from "~/lib/smart-account";

const WETH             = "0x4200000000000000000000000000000000000006" as Address;
const PLATFORM_FEE_BPS = 500n;
const BPS_DENOM        = 10_000n;



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
  candidates:  SwapCandidate[];
  processable: SwapCandidate[];
  skipped:     SwapCandidate[];
  totalNetWeth: bigint;
  totalFee:     bigint;
  gasEstimate: {
    callGasLimit: bigint;
  };
}

// ── Fetch quote dari aggregator ───────────────────────────────────────────────
async function fetchRoute(
  token:   Address,
  balance: bigint,
  vault:   Address,
  chainId: number
): Promise<SwapCandidate["route"] | null> {
  try {
    const params = new URLSearchParams({
      chainId:    String(chainId),
      sellToken:  token,
      buyToken:   WETH,
      sellAmount: balance.toString(),
      taker:      vault,
      slippage:   "0.05",
    });

    const res = await fetch(`/api/quote?${params}`);
    if (!res.ok) return null;

    const q = await res.json();
    if (q?.error || !q?.transaction?.data) return null;

    return {
      to:              q.transaction.to as Address,
      data:            q.transaction.data as `0x${string}`,
      value:           BigInt(q.transaction.value || "0"),
      approvalSpender: (q.transaction.approvalAddress || q.transaction.to) as Address,
      agg:             q._tool || "LI.FI",
      grossWethOut:    BigInt(q.buyAmount || "0"),
    };
  } catch (e) {
    console.error(`[fetchRoute] Error:`, e);
    return null;
  }
}

// ── SIMULATE ──────────────────────────────────────────────────────────────────
export async function simulateBatchSwap({
  walletClient,
  chainId,
  tokens,
}: {
  walletClient: any;
  chainId:      number;
  tokens: { address: Address; symbol: string; balance: bigint }[];
}): Promise<SimulationResult> {
  // Pakai direct client hanya untuk dapat vault address — tidak send tx
  const client = await getDirectVaultClient(walletClient);
  const vault  = client.account.address;

  const limitedTokens = tokens.slice(0, 5);

  const candidates: SwapCandidate[] = await Promise.all(
    limitedTokens.map(async t => {
      if (t.balance === 0n) {
        return {
          token: t.address, symbol: t.symbol, balance: t.balance,
          status: "skip" as const, reason: "Zero balance",
          netWethOut: 0n, estimatedFee: 0n,
        };
      }

      const route = await fetchRoute(t.address, t.balance, vault, chainId);
      if (!route) {
        return {
          token: t.address, symbol: t.symbol, balance: t.balance,
          status: "skip" as const, reason: "No route",
          netWethOut: 0n, estimatedFee: 0n,
        };
      }

      const fee    = (route.grossWethOut * PLATFORM_FEE_BPS) / BPS_DENOM;
      const netOut = route.grossWethOut - fee;

      return {
        token:    t.address, symbol: t.symbol, balance: t.balance,
        route, status: "ok" as const,
        netWethOut: netOut, estimatedFee: fee,
      };
    })
  );

  const processable = candidates.filter(c => c.status === "ok");
  const skipped     = candidates.filter(c => c.status === "skip");
  const totalNetWeth = processable.reduce((a, c) => a + c.netWethOut,   0n);
  const totalFee     = processable.reduce((a, c) => a + c.estimatedFee, 0n);

  return {
    candidates, processable, skipped, totalNetWeth, totalFee,
    gasEstimate: { callGasLimit: BigInt(processable.length) * 250_000n + 100_000n },
  };
}

// ── EXECUTE ───────────────────────────────────────────────────────────────────
// Pakai getDirectVaultClient — EOA bayar gas
// (CDP Paymaster reject approve() ke token ERC20 sembarang)
export async function executeBatchSwap({
  walletClient,
  chainId,
  tokens,
}: {
  walletClient: any;
  chainId:      number;
  tokens: { address: Address; symbol: string; balance: bigint }[];
}) {
  const client = await getDirectVaultClient(walletClient);
  const vault  = client.account.address;

  const batchToProcess = tokens.slice(0, 5);

  const routeResults = await Promise.all(
    batchToProcess.map(t => fetchRoute(t.address, t.balance, vault, chainId))
  );

  const calls: { to: Address; data: `0x${string}`; value: bigint }[] = [];

  for (let i = 0; i < batchToProcess.length; i++) {
    const t = batchToProcess[i]!;
    const r = routeResults[i];
    if (!r) continue;

    // 1. Approve token ke router
    calls.push({
      to:    t.address,
      value: 0n,
      data:  encodeFunctionData({
        abi:          erc20Abi,
        functionName: "approve",
        args:         [r.approvalSpender, t.balance],
      }),
    });

    // 2. Swap via aggregator
    calls.push({ to: r.to, value: r.value, data: r.data });
  }

  if (calls.length === 0) throw new Error("No fresh routes. try again.");

  const txHash  = await client.sendUserOperation({ calls });
  const receipt = await client.waitForUserOperationReceipt({ hash: txHash });

  return { receipt, txHash };
}