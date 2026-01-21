import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type Account } from "viem";
import { base } from "viem/chains";

const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

// 🔥 1. AMBIL API KEY DARI ENV
const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;

// 🔥 2. VALIDASI API KEY (Biar ketahuan kalau kosong)
if (!alchemyApiKey) throw new Error("Alchemy API Key missing!");
if (!pimlicoApiKey) throw new Error("Pimlico API Key missing!");

// 🔥 3. GUNAKAN TRANSPORT HTTP YANG BENAR
export const publicClient = createPublicClient({
  chain: base,
  transport: http(`https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`),
});

const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${pimlicoApiKey}`;

export const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: ENTRYPOINT_ADDRESS_V06,
    version: "0.6",
  },
});

export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("Wallet tidak terdeteksi");

  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: walletClient as WalletClient<Transport, Chain, Account>,
    factoryAddress: "0x9406Cc6185a346906296840746125a0E44976454",
    entryPoint: { address: ENTRYPOINT_ADDRESS_V06, version: "0.6" },
  });

  return createSmartAccountClient({
    account: simpleAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  }) as any as SmartAccountClient<Transport, Chain, typeof simpleAccount>;
};