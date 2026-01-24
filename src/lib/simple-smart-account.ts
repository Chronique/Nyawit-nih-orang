import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type Account } from "viem";
import { baseSepolia } from "viem/chains"; 

// EntryPoint v0.6 (Standard)
const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

// Factory Address SimpleAccount (Canonical/Standard di semua chain)
const SIMPLE_ACCOUNT_FACTORY = "0x9406Cc6185a346906296840746125a0E44976454";

/* =======================
   1. PUBLIC CLIENT (Data Blockchain)
======================= */
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"), // Atau pakai Alchemy RPC Anda
});

/* =======================
   2. PIMLICO CLIENT (Bundler & Paymaster)
======================= */
const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
if (!pimlicoApiKey) throw new Error("❌ Pimlico API Key lost!");

const PIMLICO_URL = `https://api.pimlico.io/v2/84532/rpc?apikey=${pimlicoApiKey}`;

export const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: ENTRYPOINT_ADDRESS_V06,
    version: "0.6",
  },
});

/* =======================
   3. SMART ACCOUNT CLIENT (LOGIC UTAMA)
======================= */
// Perubahan: Menerima 'accountIndex' (Salt)
export const getSmartAccountClient = async (
    walletClient: WalletClient, 
    accountIndex: bigint = 0n // 👈 Default 0 biar permanen
) => {
  if (!walletClient.account) {
    throw new Error("Wallet not detected");
  }

  // Casting owner agar sesuai format permissionless
  const owner = walletClient as WalletClient<Transport, Chain, Account>;

  // A. Setup Simple Account (Standard ERC-4337)
  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: owner,
    factoryAddress: SIMPLE_ACCOUNT_FACTORY,
    entryPoint: {
      address: ENTRYPOINT_ADDRESS_V06,
      version: "0.6",
    },
    // 🔥 PENTING: Index ini menentukan alamat wallet. 
    // 0n = Permanen. Random = Baru terus.
    index: accountIndex, 
  });

  // B. Setup Smart Account Client (Executor)
  return createSmartAccountClient({
    account: simpleAccount,
    chain: baseSepolia,
    bundlerTransport: http(PIMLICO_URL),
    
    // 🔥 SPONSORSHIP / PAYMASTER 🔥
    paymaster: pimlicoClient, 
    
    // Estimasi Gas via Pimlico
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  }) as any as SmartAccountClient<Transport, Chain, typeof simpleAccount>;
};