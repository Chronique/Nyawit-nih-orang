// src/lib/smart-account.ts
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http, type WalletClient, type Transport, type Chain, type Account } from "viem";
import { base } from "viem/chains";

// ENTRYPOINT v0.6
const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const PIMLICO_URL = `https://api.pimlico.io/v2/8453/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`;

export const bundlerClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: {
    address: ENTRYPOINT_ADDRESS_V06,
    version: "0.6",
  },
});

export const getSmartAccountClient = async (walletClient: WalletClient) => {
  // FIX ERROR: Pastikan account ada sebelum lanjut
  if (!walletClient.account) {
    throw new Error("Wallet Client tidak memiliki akun aktif.");
  }

  // Casting tipe agar sesuai dengan requirement permissionless
  const clientWithAccount = walletClient as WalletClient<Transport, Chain, Account>;

  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: clientWithAccount, // Sekarang TypeScript tahu ini pasti punya Account
    factoryAddress: "0x9406Cc6185a346906296840746125a0E44976454", // Factory Address Lama
    entryPoint: {
      address: ENTRYPOINT_ADDRESS_V06,
      version: "0.6",
    },
  });

  return createSmartAccountClient({
    account: simpleAccount,
    chain: base,
    bundlerTransport: http(PIMLICO_URL),
    // Tanpa paymaster (Self-paying dari saldo Vault)
  });
};