import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type Account } from "viem";
import { entryPoint06Address, toCoinbaseSmartAccount } from "viem/account-abstraction";
import { baseSepolia } from "viem/chains"; 

const ENTRYPOINT_ADDRESS_V06 = entryPoint06Address;

const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;

if (!alchemyApiKey) throw new Error("Alchemy API Key missing!");
if (!pimlicoApiKey) throw new Error("Pimlico API Key missing!");

// 1. Public Client (Base Sepolia)
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(`https://base-sepolia.g.alchemy.com/v2/${alchemyApiKey}`),
});

// 2. Pimlico Client (Bundler - Base Sepolia Chain ID 84532)
const PIMLICO_URL = `https://api.pimlico.io/v2/84532/rpc?apikey=${pimlicoApiKey}`;

export const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: ENTRYPOINT_ADDRESS_V06,
    version: "0.6",
  },
});

export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("Wallet tidak terdeteksi");

  // 🔥 CUSTOM OWNER WRAPPER (FIXED)
  const customOwner = {
    address: walletClient.account.address,
    
    // 1. Forward signing request ke Wallet (MetaMask/Coinbase Wallet)
    async signMessage({ message }: { message: any }) {
      return walletClient.signMessage({ message, account: walletClient.account! });
    },
    async signTypedData(params: any) {
      return walletClient.signTypedData({ ...params, account: walletClient.account! });
    },

    // 2. STUB signTransaction (PENTING!)
    // Kita biarkan function ini ada biar Type 'local' valid, 
    // tapi isinya error/kosong karena Smart Account TIDAK butuh ini untuk UserOp.
    async signTransaction(params: any) {
      throw new Error("signTransaction not supported for Smart Account owner");
    },

    // 3. Wajib 'local' agar lolos validasi 'toCoinbaseSmartAccount'
    type: "local", 
    source: "custom",
    publicKey: walletClient.account.address
  } as any; 

  // 4. Setup Coinbase Smart Account
  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [customOwner],
    version: "1.1", 
  });

  // 5. Setup Smart Account Client
  return createSmartAccountClient({
    account: coinbaseAccount,
    chain: baseSepolia,
    bundlerTransport: http(PIMLICO_URL),
    
    // Gas dibayar user sendiri (Manual Mode)
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  }) as any as SmartAccountClient<Transport, Chain, typeof coinbaseAccount>;
};