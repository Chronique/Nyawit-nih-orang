import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type LocalAccount } from "viem";
import { base } from "viem/chains"; 
import { toCoinbaseSmartAccount } from "viem/account-abstraction";

const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;

export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"), 
});

const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: { address: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", version: "0.6" },
});

export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("Wallet not detected");

  // [FIX UTAMA] Bridge Owner Wrapper untuk menghindari error Raw Sign di Farcaster
  const bridgeOwner: LocalAccount = {
    address: walletClient.account.address,
    publicKey: walletClient.account.address,
    source: 'custom',
    type: 'local', 
    
    // Paksa semua signing menggunakan standar yang aman (personal_sign)
    signMessage: async ({ message }: { message: any }) => {
        return walletClient.signMessage({ 
            message, 
            account: walletClient.account! 
        });
    },
    
    signTypedData: async (params: any) => {
        return walletClient.signTypedData({ 
            ...params, 
            account: walletClient.account! 
        });
    },

    signTransaction: () => { throw new Error("Not supported: Smart Account signer cannot sign raw transactions"); }
  } as any;

  const coinbaseAccount = await toCoinbaseSmartAccount({
    client: publicClient, 
    owners: [bridgeOwner], 
    nonce: 0n, 
    version: "1.1" 
  });

  return createSmartAccountClient({
    account: coinbaseAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
    paymaster: pimlicoClient, 
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  });
};