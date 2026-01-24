import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type LocalAccount } from "viem";
import { baseSepolia } from "viem/chains"; 
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { toAccount } from "viem/accounts"; 

// EntryPoint v0.6
const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

/* =======================
   1. PUBLIC CLIENT
======================= */
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"), 
});

/* =======================
   2. PIMLICO CLIENT
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
   3. COINBASE SMART ACCOUNT CLIENT
======================= */
export const getCoinbaseSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) {
    throw new Error("Wallet not detected");
  }

  // 🔥 CUSTOM OWNER ADAPTER (FIXED)
  // Kita gunakan toAccount untuk membuat LocalAccount yang valid.
  const owner = toAccount({
    address: walletClient.account.address,
    
    // 1. Sign Message (Fallback)
    async signMessage({ message }) {
      return walletClient.signMessage({ 
        message, 
        account: walletClient.account! 
      });
    },

    // 2. Sign Typed Data (EIP-712) - FIX ERROR TYPESCRIPT
    // Masalah sebelumnya: TypeScript bingung mencocokkan Generic Types.
    // Solusi: Kita spread 'parameters' dan cast ke 'any'.
    // Ini memberi tahu TS: "Percaya saja, objek ini valid kok, kirim ke wallet!"
    async signTypedData(parameters) {
      return walletClient.signTypedData({ 
        account: walletClient.account!,
        ...(parameters as any) // 👈 MAGIC FIX: Bypass Generic Checking
      });
    },

    // 3. Sign Transaction (Dummy)
    async signTransaction(tx) {
        // @ts-ignore
        return walletClient.signTransaction({
            ...tx,
            account: walletClient.account!
        });
    }
  });

  console.log("🔍 [Coinbase] Initializing via Viem 'toAccount'...");

  // 🔥 SETUP COINBASE SMART ACCOUNT
  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner], 
    nonce: 0n, // Deterministik
    version: "1.1" // Wajib ada
  });

  console.log("✅ [Coinbase] Account Ready:", coinbaseAccount.address);

  // Setup Executor (Permissionless Client)
  return createSmartAccountClient({
    account: coinbaseAccount,
    chain: baseSepolia,
    bundlerTransport: http(PIMLICO_URL),
    
    // Gas Sponsorship
    paymaster: pimlicoClient, 
    
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  }) as any as SmartAccountClient<Transport, Chain, typeof coinbaseAccount>;
};