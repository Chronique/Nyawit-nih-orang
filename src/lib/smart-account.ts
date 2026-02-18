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

// Tipe unified untuk semua caller — tidak perlu tahu native vs permissionless
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
// Deteksi native smart wallet via EIP-5792
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
// Path 1 — Native Smart Wallet (Base App, Farcaster, Coinbase Smart Wallet)
// Pakai wallet_sendCalls (EIP-5792) — tidak butuh raw sign
// -----------------------------------------------------------------------------
const createNativeSmartWalletClient = (walletClient: WalletClient): UnifiedSmartClient => {
  const address = walletClient.account!.address;

  return {
    account: { address },

    sendUserOperation: async ({ calls }: { calls: UnifiedCall[] }): Promise<`0x${string}`> => {
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
          if (status?.status === "FAILED") throw new Error("Transaction bundle failed");
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
// Main export
// -----------------------------------------------------------------------------
export const getSmartAccountClient = async (walletClient: WalletClient): Promise<UnifiedSmartClient> => {
  if (!walletClient.account) throw new Error("Wallet not connected");

  const smartWallet = await isNativeSmartWallet(walletClient);

  if (smartWallet) {
    console.log("Native Smart Wallet — using wallet_sendCalls (EIP-5792)");
    return createNativeSmartWalletClient(walletClient);
  }

  // EOA path — bungkus dengan toAccount() agar jadi LocalAccount yang valid
  console.log("EOA — creating Coinbase Smart Account via factory");

  const ownerAccount = toAccount({
    address: walletClient.account.address,
    signMessage: ({ message }) =>
      walletClient.signMessage({ message, account: walletClient.account! }),
    signTypedData: (params) =>
      walletClient.signTypedData({ ...(params as any), account: walletClient.account! }),
    signTransaction: () => {
      throw new Error("signTransaction not supported");
    },
  });

  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [ownerAccount],
    nonce: 0n,
    version: "1.1",
  });

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

  // Wrap permissionless client ke UnifiedSmartClient agar interface sama
  return {
    account: { address: coinbaseAccount.address },
    sendUserOperation: async ({ calls }: { calls: UnifiedCall[] }) => {
      return permissionlessClient.sendUserOperation({
        calls,
      } as any);
    },
    waitForUserOperationReceipt: async ({ hash }) => {
      return permissionlessClient.waitForUserOperationReceipt({ hash }) as any;
    },
  };
};
