import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { 
  createPublicClient, 
  http, 
  type WalletClient, 
  type Transport, 
  type Chain,
  type LocalAccount
} from "viem";
import { base } from "viem/chains"; // 👈 GANTI KE BASE MAINNET
import { toSimpleSmartAccount } from "permissionless/accounts"; 

const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const SIMPLE_ACCOUNT_FACTORY = "0x9406Cc6185a346906296840746125a0E44976454";

const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
// 👇 GANTI URL KE 8453 (BASE MAINNET)
const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;

export const publicClient = createPublicClient({
  chain: base, // 👈 MAINNET
  transport: http("https://mainnet.base.org"), 
});

export const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: ENTRYPOINT_ADDRESS_V06,
    version: "0.6",
  },
});

export const getZeroDevSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("Wallet not detected");

  const owner: LocalAccount = {
    address: walletClient.account.address,
    publicKey: walletClient.account.address,
    source: 'custom',
    type: 'local',
    
    signMessage: async ({ message }: { message: any }) => {
      console.log("✍️ [SimpleAccount] Signing Message...");
      return walletClient.signMessage({ message, account: walletClient.account! });
    },
    
    signTypedData: async (params: any) => {
      console.log("✍️ [SimpleAccount] Signing Typed Data...");
      const { domain, types, primaryType, message } = params;
      // 👈 PASTIKAN CHAIN ID MAINNET (8453)
      if (domain && !domain.chainId) domain.chainId = base.id;

      return walletClient.signTypedData({
        account: walletClient.account!,
        domain,
        types,
        primaryType,
        message
      });
    },
    
    signTransaction: () => { throw new Error("Not supported"); }
  } as any;

  console.log("⚙️ Initializing SimpleAccount on Base Mainnet...");

  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: owner, 
    factoryAddress: SIMPLE_ACCOUNT_FACTORY,
    entryPoint: {
        address: ENTRYPOINT_ADDRESS_V06,
        version: "0.6"
    },
    index: 0n, 
  });

  console.log("✅ Mainnet Address:", simpleAccount.address);

  return createSmartAccountClient({
    account: simpleAccount,
    chain: base, // 👈 MAINNET
    bundlerTransport: http(PIMLICO_URL),
    paymaster: pimlicoClient, 
    userOperation: {
      estimateFeesPerGas: async () => {
        const gasPrices = await pimlicoClient.getUserOperationGasPrice();
        return {
            maxFeePerGas: gasPrices.fast.maxFeePerGas,
            maxPriorityFeePerGas: gasPrices.fast.maxPriorityFeePerGas
        };
      },
    },
  }) as any as SmartAccountClient<Transport, Chain, typeof simpleAccount>;
};