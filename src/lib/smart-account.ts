import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Address } from "viem";
import { toAccount } from "viem/accounts";
import { base } from "viem/chains";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";

const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;

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

// -----------------------------------------------------------------------------
// Deteksi native smart wallet (EIP-5792)
// Coinbase Smart Wallet, Base App, Farcaster App semuanya support ini
// -----------------------------------------------------------------------------
const isNativeSmartWallet = async (walletClient: WalletClient): Promise<boolean> => {
  try {
    await walletClient.request({ method: "wallet_getCapabilities" as any });
    return true;
  } catch {
    return false;
  }
};

// -----------------------------------------------------------------------------
// Path 1 — Native Smart Wallet (EIP-5792)
// Kirim batch tx via wallet_sendCalls, tidak butuh raw sign sama sekali
// -----------------------------------------------------------------------------
const createNativeSmartWalletClient = (walletClient: WalletClient) => {
  const address = walletClient.account!.address;

  return {
    account: { address },

    sendUserOperation: async ({
      calls,
    }: {
      account?: any;
      calls: Array<{ to: Address; value: bigint; data: `0x${string}` }>;
    }): Promise<`0x${string}`> => {
      const bundleId = await walletClient.request({
        method: "wallet_sendCalls" as any,
        params: [
          {
            version: "1.0",
            chainId: `0x${base.id.toString(16)}`,
            calls: calls.map((c) => ({
              to: c.to,
              value: `0x${(c.value ?? 0n).toString(16)}`,
              data: c.data || "0x",
            })),
          },
        ],
      });
      console.log("wallet_sendCalls bundleId:", bundleId);
      return bundleId as `0x${string}`;
    },

    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      const MAX_ATTEMPTS = 60;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        try {
          const status = (await walletClient.request({
            method: "wallet_getCallsStatus" as any,
            params: [hash],
          })) as any;

          if (
            status?.status === "CONFIRMED" ||
            (status?.receipts && status.receipts.length > 0)
          ) {
            return { receipt: status.receipts?.[0] ?? status };
          }
          if (status?.status === "FAILED") {
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
// Main export — otomatis pilih path yang tepat
// -----------------------------------------------------------------------------
export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("Wallet not connected");

  const smartWallet = await isNativeSmartWallet(walletClient);

  if (smartWallet) {
    // Base App / Farcaster / Coinbase Smart Wallet → pakai EIP-5792 langsung
    console.log("Native Smart Wallet — using wallet_sendCalls (EIP-5792)");
    return createNativeSmartWalletClient(walletClient);
  }

  // EOA (Rabby, MetaMask, Injected)
  // walletClient.account = JsonRpcAccount → TIDAK bisa langsung dipakai sebagai owner.
  // Harus dibungkus pakai toAccount() agar jadi LocalAccount yang valid.
  console.log("EOA — creating Coinbase Smart Account via factory");

  const ownerAccount = toAccount({
    address: walletClient.account.address,

    signMessage: ({ message }) =>
      walletClient.signMessage({
        message,
        account: walletClient.account!,
      }),

    signTypedData: (params) =>
      walletClient.signTypedData({
        ...(params as any),
        account: walletClient.account!,
      }),

    signTransaction: () => {
      throw new Error("signTransaction not supported for smart account owner");
    },
  });

  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [ownerAccount],
    nonce: 0n,
    version: "1.1",
  });

  return createSmartAccountClient({
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
};
