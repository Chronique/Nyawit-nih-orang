import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts"; // 👈 Kembali ke SimpleAccount
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type Account } from "viem";
import { base } from "viem/chains"; // Gunakan Base Mainnet

// EntryPoint v0.6
const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const SIMPLE_ACCOUNT_FACTORY = "0x9406Cc6185a346906296840746125a0E44976454";

const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`; // Base Mainnet

export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

export const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: { 
    address: ENTRYPOINT_ADDRESS_V06, 
    version: "0.6" 
  },
});

export const getSmartAccountClient = async (
    walletClient: WalletClient, 
    accountIndex: bigint = 0n 
) => {
  if (!walletClient.account) throw new Error("Wallet not detected");

  // Casting owner
  const owner = walletClient as WalletClient<Transport, Chain, Account>;

  // A. Setup Simple Account (ZeroDev / Kernel Old)
  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: owner,
    factoryAddress: SIMPLE_ACCOUNT_FACTORY,
    entryPoint: {
      address: ENTRYPOINT_ADDRESS_V06,
      version: "0.6",
    },
    index: accountIndex, 
  });

  // B. Setup Smart Account Client
  return createSmartAccountClient({
    account: simpleAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
    paymaster: pimlicoClient, 
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  }) as any as SmartAccountClient<Transport, Chain, typeof simpleAccount>;
};