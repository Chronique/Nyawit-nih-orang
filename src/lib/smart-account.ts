import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type Account } from "viem";
import { base } from "viem/chains";

// ENTRYPOINT v0.6
const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

// Pastikan API Key Pimlico terbaca
const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;

export const bundlerClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: ENTRYPOINT_ADDRESS_V06,
    version: "0.6",
  },
});

export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) {
    throw new Error("Wallet Client tidak memiliki akun aktif.");
  }

  const clientWithAccount = walletClient as WalletClient<Transport, Chain, Account>;

  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: clientWithAccount,
    factoryAddress: "0x9406Cc6185a346906296840746125a0E44976454", 
    entryPoint: {
      address: ENTRYPOINT_ADDRESS_V06,
      version: "0.6",
    },
  });

  // FIX: 
  // 1. Gunakan 'as any' di dalam config untuk bypass error middleware strictness.
  // 2. Gunakan 'as SmartAccountClient<...>' di luar untuk memberitahu TypeScript 
  //    bahwa return value ini PASTI memiliki akun (typeof simpleAccount).
  
  return createSmartAccountClient({
    account: simpleAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
    middleware: {
      gasPrice: async () => {
        return (await bundlerClient.getUserOperationGasPrice()).fast;
      },
    },
  } as any) as SmartAccountClient<Transport, Chain, typeof simpleAccount>;
};