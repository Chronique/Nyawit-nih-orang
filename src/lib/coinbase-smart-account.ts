import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type Hex } from "viem";
import { baseSepolia } from "viem/chains"; 
import { toCoinbaseSmartAccount, entryPoint06Address } from "viem/account-abstraction";
import { toAccount } from "viem/accounts"; 

const ENTRYPOINT_ADDRESS_V06 = entryPoint06Address;

// 1. PUBLIC CLIENT
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

// 2. PIMLICO CLIENT
const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
if (!pimlicoApiKey) throw new Error("❌ API Key Pimlico hilang!");

const PIMLICO_URL = `https://api.pimlico.io/v2/84532/rpc?apikey=${pimlicoApiKey}`;

export const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: ENTRYPOINT_ADDRESS_V06,
    version: "0.6",
  },
});

/**
 * HELPER: WRAPPER OWNER
 * Mengubah WalletClient (EOA) menjadi 'LocalAccount' palsu agar diterima oleh toCoinbaseSmartAccount.
 */
const getWrapperOwner = (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("Wallet not connected");
  
  const address = walletClient.account.address;

  // Kita gunakan toAccount untuk membuat objek akun yang valid secara Tipe Data
  return toAccount({
    address: address,
    type: "local",     // 👈 Ini kunci agar TypeScript tidak error
    source: "custom",
    
    // Delegasi Sign Message ke Wallet Asli
    async signMessage({ message }) {
      return walletClient.signMessage({ message, account: address });
    },
    
    // Delegasi Sign Typed Data ke Wallet Asli
    async signTypedData(typedData) {
      return walletClient.signTypedData({ ...typedData, account: address } as any);
    },
    
    // Dummy Sign Transaction (Hanya untuk memuaskan TypeScript/Viem validation)
    async signTransaction(transaction) {
      return "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as Hex;
    },
  });
};

// 3. COINBASE SMART ACCOUNT CLIENT
export const getCoinbaseSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) {
    throw new Error("Wallet tidak terdeteksi");
  }

  // 🔥 GUNAKAN WRAPPER DI SINI
  const wrappedOwner = getWrapperOwner(walletClient);

  // A. Setup Coinbase Account
  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [wrappedOwner],
    
    // 🔥 WAJIB ADA: Versi Logic Coinbase Smart Wallet
    version: "1.1", 
  });

  // B. Setup Executor
  return createSmartAccountClient({
    account: coinbaseAccount,
    chain: baseSepolia,
    bundlerTransport: http(PIMLICO_URL),
    paymaster: pimlicoClient, 
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  }) as any as SmartAccountClient<Transport, Chain, typeof coinbaseAccount>;
};