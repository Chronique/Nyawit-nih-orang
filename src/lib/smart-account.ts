import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico"; // ✅ Ganti import
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type Account } from "viem";
import { base } from "viem/chains";

// ENTRYPOINT v0.6
const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

/* =======================
   PUBLIC CLIENT (BASE)
======================= */
export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

/* =======================
   PIMLICO CONFIG
======================= */
const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;

if (!pimlicoApiKey) {
  throw new Error("❌ NEXT_PUBLIC_PIMLICO_API_KEY belum diset");
}

const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;

// ✅ GUNAKAN createPimlicoClient (Sesuai saran error log)
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
export const getSmartAccountClient = async (
  walletClient: WalletClient
): Promise<SmartAccountClient> => {
  if (!walletClient.account) {
    throw new Error("Wallet Client tidak memiliki akun aktif");
  }

  const owner = walletClient as WalletClient<Transport, Chain, Account>;

  // 1. BUAT SIMPLE ACCOUNT
  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner,
    factoryAddress: "0x9406Cc6185a346906296840746125a0E44976454",
    entryPoint: {
      address: ENTRYPOINT_ADDRESS_V06,
      version: "0.6",
    },
  });

  // 2. BUAT SMART ACCOUNT CLIENT (GASLESS)
  return createSmartAccountClient({
    account: simpleAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
    
    // ✅ FITUR SPONSOR (GASLESS)
    sponsorUserOperation: pimlicoClient.sponsorUserOperation, 
    
  } as any) as SmartAccountClient<Transport, Chain, typeof simpleAccount>; 
  // 👆 'as any' di atas SANGAT PENTING untuk membungkam error TypeScript
};