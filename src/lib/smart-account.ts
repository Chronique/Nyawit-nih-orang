import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type LocalAccount } from "viem";
import { base } from "viem/chains"; // MAINNET
import { toCoinbaseSmartAccount } from "viem/account-abstraction";

const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;

export const coinbasePublicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"), 
});

const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: { address: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", version: "0.6" },
});

export const getCoinbaseSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("Wallet not detected");

  const bridgeOwner: LocalAccount = {
    address: walletClient.account.address,
    publicKey: walletClient.account.address,
    source: 'custom',
    type: 'local', 
    signMessage: async ({ message }: { message: any }) => walletClient.signMessage({ message, account: walletClient.account! }),
    signTypedData: async (params: any) => walletClient.signTypedData({ ...params, account: walletClient.account! }),
    signTransaction: () => { throw new Error("Not supported"); }
  } as any;

  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: coinbasePublicClient,
    owners: [bridgeOwner], 
    nonce: 0n, 
    version: "1.1" 
  });

  return createSmartAccountClient({
    account: coinbaseAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
    paymaster: pimlicoClient, 
    userOperation: { estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast },
  }) as any as SmartAccountClient<Transport, Chain, typeof coinbaseAccount>;
};