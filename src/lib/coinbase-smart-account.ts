import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type LocalAccount } from "viem";
import { baseSepolia } from "viem/chains"; 
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { toAccount } from "viem/accounts"; 

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
const PIMLICO_URL = `https://api.pimlico.io/v2/84532/rpc?apikey=${pimlicoApiKey}`;

export const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: ENTRYPOINT_ADDRESS_V06,
    version: "0.6",
  },
});

/* =======================
   3. COINBASE SMART ACCOUNT (WITH PAYMASTER)
======================= */
export const getCoinbaseSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("Wallet not detected");

  // 🔥 CUSTOM OWNER ADAPTER 🔥
  // Kita bungkus WalletClient Wagmi menjadi 'Account' Viem yang valid.
  // Ini memaksa Viem menggunakan 'signTypedData' untuk UserOp, bukan 'signMessage'.
  const customOwner = toAccount({
    address: walletClient.account.address,
    
    // A. Sign Message (Fallback)
    async signMessage({ message }) {
      return walletClient.signMessage({ message, account: walletClient.account! });
    },

    // B. Sign Typed Data (EIP-712) - INI YANG DIPAKAI COINBASE
    async signTypedData(parameters) {
      // Kita spread parameter dan cast ke 'any' untuk memuaskan TypeScript
      // Secara runtime, ini akan mengirim data EIP-712 yang benar ke Wallet.
      return walletClient.signTypedData({ 
        account: walletClient.account!,
        ...(parameters as any)
      });
    },

    // C. Sign Transaction (Dummy)
    async signTransaction(tx) {
        // @ts-ignore
        return walletClient.signTransaction({ ...tx, account: walletClient.account! });
    }
  });

  console.log("🔍 [CSW] Initializing with Custom Adapter...");

  // Setup Coinbase Account menggunakan customOwner tadi
  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [customOwner], 
    nonce: 0n, // Deterministik
    version: "1.1" 
  });

  console.log("✅ [CSW] Account Ready:", coinbaseAccount.address);

  // Setup Permissionless Client (UserOp Executor)
  return createSmartAccountClient({
    account: coinbaseAccount,
    chain: baseSepolia,
    bundlerTransport: http(PIMLICO_URL),
    
    // 🔥 PENTING: PAYMASTER 🔥
    // Inilah yang membuat Gas = 0 ETH (Sponsored) atau dibayar oleh Vault.
    paymaster: pimlicoClient, 
    
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  }) as any as SmartAccountClient<Transport, Chain, typeof coinbaseAccount>;
};