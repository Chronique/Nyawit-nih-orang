// src/lib/smart-account.ts
//
// ARSITEKTUR:
// - Semua wallet → CoinbaseSmartAccount factory → alamat Wallet C deterministik
// - Aktivasi: user bayar gas sendiri (NO paymaster)
// - Operasi setelah aktif: ETH di dalam Wallet C
// - Pimlico hanya sebagai BUNDLER (bukan paymaster)
//
// CARA SIGN UserOp tergantung wallet user:
// - Farcaster / Base App      → wallet_sendCalls (EIP-5792), wallet yang handle
// - Coinbase Wallet (web/ext) → wallet_sendCalls (EIP-5792)
// - Browser wallet lain       → walletClient.signMessage → Pimlico bundler
//
// ALAMAT WALLET C SELALU SAMA untuk owner yang sama, apapun wallet yang dipakai.

import { createPublicClient, http, type WalletClient, type Address } from "viem";
import { base } from "viem/chains";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { createBundlerClient } from "viem/account-abstraction";

const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
const PIMLICO_BUNDLER_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;
const BASE_CHAIN_ID_HEX = `0x${base.id.toString(16)}`; // "0x2105"

export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

// Bundler-only client — TIDAK ada paymaster
// Gas dibayar dari ETH di dalam Wallet C
const bundlerClient = createBundlerClient({
  transport: http(PIMLICO_BUNDLER_URL),
  chain: base,
});

export interface UnifiedCall {
  to: Address;
  value: bigint;
  data: `0x${string}`;
}

export interface UnifiedSmartClient {
  account: { address: Address };
  sendUserOperation: (params: { calls: UnifiedCall[] }) => Promise<`0x${string}`>;
  waitForUserOperationReceipt: (params: { hash: `0x${string}` }) => Promise<{ receipt: any }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derive alamat Wallet C (tanpa deploy)
// Ini deterministik — owner sama → alamat sama selalu
// ─────────────────────────────────────────────────────────────────────────────
export const deriveVaultAddress = async (ownerAddress: Address): Promise<Address> => {
  // Buat dummy owner — hanya untuk derive alamat, tidak butuh sign
  const dummyOwner = {
    address: ownerAddress,
    signMessage: async (): Promise<`0x${string}`> => "0x",
    signTypedData: async (): Promise<`0x${string}`> => "0x",
    type: "local" as const,
    publicKey: "0x" as `0x${string}`,
    source: "custom" as const,
  };

  const account = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [dummyOwner as any],
    nonce: 0n,
    version: "1",
  });

  return account.address;
};

// ─────────────────────────────────────────────────────────────────────────────
// Deteksi cara sign — BUKAN untuk menentukan alamat vault
// Hanya menentukan bagaimana UserOp dikirim
// ─────────────────────────────────────────────────────────────────────────────
type SignMethod = "eip5792" | "bundler";

const detectSignMethod = (): SignMethod => {
  if (typeof window === "undefined") return "eip5792"; // SSR / Farcaster

  const eth = (window as any).ethereum;

  // Tidak ada window.ethereum → Farcaster SDK / Base App
  if (!eth) {
    console.log("[SignMethod] No window.ethereum → EIP-5792");
    return "eip5792";
  }

  // Coinbase Wallet (extension atau Smart Wallet web)
  if (
    eth.isCoinbaseWallet === true ||
    eth.isCoinbaseBrowser === true ||
    (window as any).__cbswDetected === true ||
    (window as any).coinbaseWalletExtension
  ) {
    console.log("[SignMethod] Coinbase Wallet → EIP-5792");
    return "eip5792";
  }

  // EIP-6963 providers array
  if (Array.isArray(eth.providers)) {
    const hasCoinbase = eth.providers.some(
      (p: any) => p.isCoinbaseWallet === true || p.isCoinbaseBrowser === true
    );
    if (hasCoinbase) {
      console.log("[SignMethod] Coinbase in providers[] → EIP-5792");
      return "eip5792";
    }
  }

  // Semua wallet lain (OKX, Rabby, MetaMask) → sign manual via bundler
  console.log("[SignMethod] Other browser wallet → bundler");
  return "bundler";
};

// ─────────────────────────────────────────────────────────────────────────────
// Path A: EIP-5792 (Farcaster, Base App, Coinbase Wallet)
// wallet_sendCalls — wallet yang handle sign + kirim UserOp
// Gas untuk aktivasi: user approve di popup wallet mereka
// ─────────────────────────────────────────────────────────────────────────────
const createEIP5792Client = (walletClient: WalletClient, vaultAddress: Address): UnifiedSmartClient => {
  return {
    account: { address: vaultAddress },

    sendUserOperation: async ({ calls }: { calls: UnifiedCall[] }): Promise<`0x${string}`> => {
      console.log("[EIP5792] wallet_sendCalls v2.0.0, calls:", calls.length);

      const bundleId = await walletClient.request({
        method: "wallet_sendCalls" as any,
        params: [
          {
            version: "2.0.0",
            chainId: BASE_CHAIN_ID_HEX,
            calls: calls.map((c) => ({
              to: c.to,
              value: `0x${(c.value ?? 0n).toString(16)}`,
              data: c.data || "0x",
            })),
          },
        ],
      });

      console.log("[EIP5792] bundleId:", bundleId);
      return bundleId as `0x${string}`;
    },

    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      const MAX = 60;
      for (let i = 0; i < MAX; i++) {
        try {
          const status = (await walletClient.request({
            method: "wallet_getCallsStatus" as any,
            params: [hash],
          })) as any;

          console.log(`[EIP5792] Poll ${i + 1}/${MAX}:`, status?.status);

          const done =
            status?.status === "CONFIRMED" ||
            status?.status === "confirmed" ||
            status?.statusCode === 200 ||
            (status?.receipts?.length > 0);

          if (done) return { receipt: status.receipts?.[0] ?? status };
          if (status?.status === "FAILED" || status?.status === "failed") {
            throw new Error("Transaction bundle failed");
          }
        } catch (e: any) {
          if (e?.message?.includes("failed")) throw e;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error("Timeout: transaction not confirmed after 2 minutes");
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Path B: Manual sign + Pimlico bundler (OKX, Rabby, MetaMask, dll)
// walletClient.signMessage → sign UserOp hash
// Pimlico bundler → forward ke EntryPoint
// Gas: diambil dari ETH di Wallet C (bukan paymaster)
// ─────────────────────────────────────────────────────────────────────────────
const createBundlerClient_ = async (walletClient: WalletClient): Promise<UnifiedSmartClient> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  console.log("[Bundler] Preparing CoinbaseSmartAccount for:", walletClient.account.address);

  // Owner: delegate sign ke walletClient — TIDAK pakai toAccount() wrapper
  // karena toAccount() dari viem tidak compatible dengan wagmi walletClient
  const owner = {
    address: walletClient.account.address,
    signMessage: async ({ message }: { message: any }): Promise<`0x${string}`> => {
      return walletClient.signMessage({
        account: walletClient.account!,
        message,
      });
    },
    signTypedData: async (params: any): Promise<`0x${string}`> => {
      return walletClient.signTypedData({
        ...params,
        account: walletClient.account!,
      });
    },
    type: "local" as const,
    publicKey: "0x" as `0x${string}`,
    source: "custom" as const,
  };

  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner as any],
    nonce: 0n,
    version: "1",
  });

  console.log("[Bundler] Wallet C address:", coinbaseAccount.address);

  // SmartAccount client dengan bundler-only (NO paymaster)
  // Gas dibayar dari ETH di dalam Wallet C
  const { createSmartAccountClient } = await import("permissionless");

  const smartClient = createSmartAccountClient({
    account: coinbaseAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_BUNDLER_URL),
    // Tidak ada `paymaster` — user bayar sendiri
  });

  return {
    account: { address: coinbaseAccount.address },

    sendUserOperation: async ({ calls }: { calls: UnifiedCall[] }) => {
      console.log("[Bundler] Sending UserOp, calls:", calls.length);

      // Sanitize: pastikan value dan data tidak undefined
      // permissionless akan throw "Cannot convert undefined to BigInt"
      // kalau value tidak diisi
      const sanitizedCalls = calls.map((c) => ({
        to: c.to,
        value: c.value ?? 0n,
        data: (c.data ?? "0x") as `0x${string}`,
      }));

      console.log("[Bundler] Sanitized calls:", JSON.stringify(sanitizedCalls, (_, v) =>
        typeof v === "bigint" ? v.toString() : v
      ));

      return smartClient.sendUserOperation({ calls: sanitizedCalls } as any);
    },

    waitForUserOperationReceipt: async ({ hash }) => {
      console.log("[Bundler] Waiting for receipt:", hash);
      return smartClient.waitForUserOperationReceipt({ hash }) as any;
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Main export — satu fungsi untuk semua wallet
// ─────────────────────────────────────────────────────────────────────────────
export const getSmartAccountClient = async (
  walletClient: WalletClient
): Promise<UnifiedSmartClient> => {
  if (!walletClient.account) throw new Error("Wallet not connected");

  const method = detectSignMethod();
  console.log(`[SmartAccount] owner=${walletClient.account.address}, signMethod=${method}`);

  if (method === "eip5792") {
    // Derive vault address dulu untuk info UI
    const vaultAddress = await deriveVaultAddress(walletClient.account.address);
    console.log("[SmartAccount] Vault C address (EIP-5792):", vaultAddress);
    return createEIP5792Client(walletClient, vaultAddress);
  }

  // bundler path: buat full smart account client
  return createBundlerClient_(walletClient);
};

// ─────────────────────────────────────────────────────────────────────────────
// Export helper untuk komponen UI
// ─────────────────────────────────────────────────────────────────────────────

/** Cek apakah Wallet C sudah di-deploy (aktif) */
export const isVaultDeployed = async (vaultAddress: Address): Promise<boolean> => {
  const code = await publicClient.getBytecode({ address: vaultAddress });
  return code !== undefined && code !== null && code !== "0x";
};