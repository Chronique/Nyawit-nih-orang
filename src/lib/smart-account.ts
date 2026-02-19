// src/lib/smart-account.ts
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Address } from "viem";
import { base } from "viem/chains";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";

const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;
const BASE_CHAIN_ID_HEX = `0x${base.id.toString(16)}`; // "0x2105"

export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
    version: "0.6",
  },
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

// -----------------------------------------------------------------------------
// Deteksi apakah ini Farcaster/Base App (native) atau browser wallet (EOA path)
//
// KENAPA BEGINI:
// - Farcaster/Base App → tidak ada window.ethereum → native path (wallet_sendCalls)
// - OKX, Rabby, MetaMask → punya window.ethereum → EOA path (Pimlico EIP-4337)
// - Coinbase Wallet ext → window.ethereum.isCoinbaseWallet = true → native path
// -----------------------------------------------------------------------------
const isFarcasterOrBaseAppWallet = (): boolean => {
  if (typeof window === "undefined") return true; // SSR → anggap native

  const eth = (window as any).ethereum;

  // Tidak ada window.ethereum → Farcaster SDK inject → native path
  if (!eth) {
    console.log("[SmartWallet] No window.ethereum → Farcaster/Base App connector");
    return true;
  }

  // Coinbase Wallet extension → support EIP-5792 dengan benar (bukan 7702)
  if (eth.isCoinbaseWallet === true || eth.isCoinbaseBrowser === true) {
    console.log("[SmartWallet] Coinbase Wallet extension detected → native path");
    return true;
  }

  // Wallet lain (OKX, Rabby, MetaMask, dll) → EOA path
  console.log("[SmartWallet] Browser wallet detected → forcing EOA path (EIP-4337)");
  return false;
};

// -----------------------------------------------------------------------------
// Path 1 — Native Smart Wallet (Farcaster / Base App / Coinbase Wallet ext)
// Pakai wallet_sendCalls (EIP-5792) v2.0.0
// Wallet yang handle UserOp sendiri — tidak butuh raw sign
// -----------------------------------------------------------------------------
const createNativeSmartWalletClient = (walletClient: WalletClient): UnifiedSmartClient => {
  const address = walletClient.account!.address;

  return {
    account: { address },

    sendUserOperation: async ({ calls }: { calls: UnifiedCall[] }): Promise<`0x${string}`> => {
      console.log("[NativeWallet] wallet_sendCalls v2.0.0, calls:", calls.length);

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

      console.log("[NativeWallet] bundleId:", bundleId);
      return bundleId as `0x${string}`;
    },

    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      console.log("[NativeWallet] Polling bundle status:", hash);
      const MAX_ATTEMPTS = 60;

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        try {
          const status = (await walletClient.request({
            method: "wallet_getCallsStatus" as any,
            params: [hash],
          })) as any;

          console.log(`[NativeWallet] Poll ${i + 1}/${MAX_ATTEMPTS}:`, status?.status);

          const isConfirmed =
            status?.status === "CONFIRMED" ||
            status?.status === "confirmed" ||
            status?.statusCode === 200 ||
            (status?.receipts && status.receipts.length > 0);

          if (isConfirmed) return { receipt: status.receipts?.[0] ?? status };
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

// -----------------------------------------------------------------------------
// Path 2 — EOA via Pimlico (OKX, Rabby, MetaMask, dll)
//
// FIX ROOT CAUSE "owner does not support raw sign":
// toAccount() dari viem tidak compatible dengan wagmi walletClient.
// Solusi: buat owner langsung dari walletClient dengan cara yang benar —
// gunakan walletClient itu sendiri sebagai signer tanpa wrapping toAccount()
// -----------------------------------------------------------------------------
const createEOASmartClient = async (walletClient: WalletClient): Promise<UnifiedSmartClient> => {
  console.log("[EOA] Creating CoinbaseSmartAccount via Pimlico (EIP-4337)");

  if (!walletClient.account) throw new Error("walletClient.account is null");

  // [FIX] Buat owner object yang compatible dengan toCoinbaseSmartAccount
  // Langsung delegate sign ke walletClient — tidak pakai toAccount() wrapper
  const owner = {
    address: walletClient.account.address,

    // signMessage: dipakai untuk sign UserOp hash
    signMessage: async ({ message }: { message: any }): Promise<`0x${string}`> => {
      return walletClient.signMessage({
        account: walletClient.account!,
        message,
      });
    },

    // signTypedData: dipakai untuk EIP-712 sign (UserOp v0.7+)
    signTypedData: async (params: any): Promise<`0x${string}`> => {
      return walletClient.signTypedData({
        ...params,
        account: walletClient.account!,
      });
    },

    // type hint agar viem tahu ini LocalAccount-compatible
    type: "local" as const,
    publicKey: "0x" as `0x${string}`,
    source: "custom" as const,
  };

  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner as any],
    nonce: 0n,
    version: "1.1",
  });

  console.log("[EOA] CoinbaseSmartAccount address:", coinbaseAccount.address);

  const permissionlessClient = createSmartAccountClient({
    account: coinbaseAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  });

  return {
    account: { address: coinbaseAccount.address },
    sendUserOperation: async ({ calls }: { calls: UnifiedCall[] }) => {
      console.log("[EOA] Sending UserOp, calls:", calls.length);
      return permissionlessClient.sendUserOperation({ calls } as any);
    },
    waitForUserOperationReceipt: async ({ hash }) => {
      console.log("[EOA] Waiting for UserOp receipt:", hash);
      return permissionlessClient.waitForUserOperationReceipt({ hash }) as any;
    },
  };
};

// -----------------------------------------------------------------------------
// Main export
// -----------------------------------------------------------------------------
export const getSmartAccountClient = async (
  walletClient: WalletClient
): Promise<UnifiedSmartClient> => {
  if (!walletClient.account) throw new Error("Wallet not connected");

  const isNative = isFarcasterOrBaseAppWallet();

  if (isNative) {
    console.log("[SmartAccount] → Native path (EIP-5792)");
    return createNativeSmartWalletClient(walletClient);
  }

  console.log("[SmartAccount] → EOA path (CoinbaseSmartAccount + Pimlico)");
  return createEOASmartClient(walletClient);
};