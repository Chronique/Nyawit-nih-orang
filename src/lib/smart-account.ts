import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type Account } from "viem";
import { base } from "viem/chains";

const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

/* =======================
   PUBLIC CLIENT
======================= */
const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
export const publicClient = createPublicClient({
  chain: base,
  // Pakai RPC Alchemy biar ngebut & gak kena limit
  transport: http(`https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`), 
});

/* =======================
   PIMLICO CLIENT (Bundler & Paymaster)
======================= */
const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
if (!pimlicoApiKey) throw new Error("❌ API Key Pimlico hilang!");

const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;

export const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: ENTRYPOINT_ADDRESS_V06,
    version: "0.6",
  },
});

/* =======================
   SMART ACCOUNT CLIENT
======================= */
export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) {
    throw new Error("Wallet tidak terdeteksi");
  }
  const owner = walletClient as WalletClient<Transport, Chain, Account>;

  // 1. Setup Simple Account
  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner,
    factoryAddress: "0x9406Cc6185a346906296840746125a0E44976454",
    entryPoint: { address: ENTRYPOINT_ADDRESS_V06, version: "0.6" },
  });

  // 2. Setup Client dengan Paymaster (Mode v0.3)
  return createSmartAccountClient({
    account: simpleAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
    
    // 🔥 INI PERUBAHANNYA: Langsung pasang paymaster di sini
    // Permissionless v0.3 akan otomatis mengatur gas & sponsor
    paymaster: pimlicoClient,
    
    // Tambahan: Pastikan estimasi gas juga minta ke Pimlico
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
    
  } as any) as SmartAccountClient<Transport, Chain, typeof simpleAccount>;
};