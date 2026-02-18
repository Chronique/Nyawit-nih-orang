import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPublicClient, http, type WalletClient, type Address } from "viem";
import { toAccount } from "viem/accounts";
import { base } from "viem/chains";

export const ENTRYPOINT_06 = {
  address: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as Address,
  version: "0.6" as const, // 🔑 FIX
};

const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`;

export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

export interface UnifiedCall {
  to: Address;
  value: bigint;
  data: `0x${string}`;
}

export interface UnifiedSmartAccountClient {
  account: { address: Address };
  sendUserOperation(params: { calls: UnifiedCall[] }): Promise<`0x${string}`>;
  waitForUserOperationReceipt(params: { hash: `0x${string}` }): Promise<any>;
}

export async function createUnifiedSmartAccountClient(
  walletClient: WalletClient
): Promise<UnifiedSmartAccountClient> {
  if (!walletClient.account) throw new Error("Wallet not connected");

  const owner = toAccount({
    address: walletClient.account.address,
    signMessage: (p) =>
      walletClient.signMessage({ ...p, account: walletClient.account! }),
    signTypedData: (p) =>
      walletClient.signTypedData({ ...(p as any), account: walletClient.account! }),
    signTransaction: () => {
      throw new Error("signTransaction not supported");
    },
  });

  const smartAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner,
    entryPoint: ENTRYPOINT_06,
  });

  const client = createSmartAccountClient({
    account: smartAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
  });

  return {
    account: { address: smartAccount.address },
    sendUserOperation: ({ calls }) =>
      client.sendUserOperation({ calls } as any),
    waitForUserOperationReceipt: ({ hash }) =>
      client.waitForUserOperationReceipt({ hash }),
  };
}
