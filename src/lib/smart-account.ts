// src/lib/smart-account.ts
//
// ARSITEKTUR:
// - EIP-5792 path (Farcaster, Base App, Coinbase Wallet): wallet_sendCalls langsung
// - Bundler path (Rabby, MetaMask, OKX): ZeroDev Kernel (ERC-7579) via ZeroDev bundler
//
// MULTI-CHAIN:
// - Base Mainnet (8453)  → NEXT_PUBLIC_ZERODEV_PROJECT_ID_MAINNET
// - Base Sepolia (84532) → NEXT_PUBLIC_ZERODEV_PROJECT_ID_TESTNET
//
// Di ZeroDev dashboard, mainnet dan testnet adalah project TERPISAH.
// Chain dideteksi otomatis dari walletClient.chain.id.

import {
  createPublicClient,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
  type Address,
} from "viem";
import { toAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";

// ─── ENV ──────────────────────────────────────────────────────────────────────
const PROJECT_ID_MAINNET = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID_MAINNET;
const PROJECT_ID_TESTNET = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID_TESTNET;

// EntryPoint v0.7 — dipakai ZeroDev Kernel v3
const ENTRYPOINT = {
  address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address,
  version: "0.7" as const,
};

// ─── Public clients per chain ─────────────────────────────────────────────────
// Disimpan sebagai typed const, tapi di ChainConfig kita pakai `any`
// karena viem meng-embed literal chain type yang tidak bisa di-union
export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

export const publicClientSepolia = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

// ─── Chain config ─────────────────────────────────────────────────────────────
// client: any karena viem PublicClient<base> dan PublicClient<baseSepolia>
// adalah dua tipe literal yang tidak compatible secara TypeScript,
// meski runtime-nya identik. Cast ke typed client dilakukan di titik penggunaan.
interface ChainConfig {
  chain: typeof base | typeof baseSepolia;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  projectId: string;
  bundlerRpc: string;
  paymasterRpc: string;
}

const getChainConfig = (chainId: number): ChainConfig => {
  if (chainId === base.id) {
    if (!PROJECT_ID_MAINNET) throw new Error("NEXT_PUBLIC_ZERODEV_PROJECT_ID_MAINNET not set");
    return {
      chain: base,
      client: publicClient,
      projectId: PROJECT_ID_MAINNET,
      bundlerRpc:   `https://rpc.zerodev.app/api/v2/bundler/${PROJECT_ID_MAINNET}`,
      paymasterRpc: `https://rpc.zerodev.app/api/v2/paymaster/${PROJECT_ID_MAINNET}`,
    };
  }
  // Default: Base Sepolia (testnet)
  if (!PROJECT_ID_TESTNET) throw new Error("NEXT_PUBLIC_ZERODEV_PROJECT_ID_TESTNET not set");
  return {
    chain: baseSepolia,
    client: publicClientSepolia,
    projectId: PROJECT_ID_TESTNET,
    bundlerRpc:   `https://rpc.zerodev.app/api/v2/bundler/${PROJECT_ID_TESTNET}`,
    paymasterRpc: `https://rpc.zerodev.app/api/v2/paymaster/${PROJECT_ID_TESTNET}`,
  };
};

// ─── Interfaces ───────────────────────────────────────────────────────────────
export interface UnifiedCall {
  to: Address;
  value: bigint;
  data: `0x${string}`;
}

export interface UnifiedSmartClient {
  account: { address: Address };
  chainId: number;
  sendUserOperation: (params: { calls: UnifiedCall[] }) => Promise<`0x${string}`>;
  waitForUserOperationReceipt: (params: { hash: `0x${string}` }) => Promise<{ receipt: any }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derive vault address (tanpa deploy — hanya compute address dari factory)
// ─────────────────────────────────────────────────────────────────────────────
const deriveKernelVaultAddress = async (
  ownerAddress: Address,
  chainId: number = baseSepolia.id
): Promise<Address> => {
  const { createKernelAccount } = await import("@zerodev/sdk");
  const { signerToEcdsaValidator } = await import("@zerodev/ecdsa-validator");
  const { KERNEL_V3_1 } = await import("@zerodev/sdk/constants");

  const { client } = getChainConfig(chainId);

  const dummyOwner = toAccount({
    address: ownerAddress,
    signMessage: async () => "0x" as `0x${string}`,
    signTypedData: async () => "0x" as `0x${string}`,
    signTransaction: async () => { throw new Error("not supported"); },
  });

  const validator = await signerToEcdsaValidator(client, {
    signer: dummyOwner,
    entryPoint: ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
  });

  const account = await createKernelAccount(client, {
    plugins: { sudo: validator },
    entryPoint: ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
  });

  return account.address;
};

export const deriveVaultAddress = async (
  ownerAddress: Address,
  method: "eip5792" | "bundler" = "eip5792",
  chainId: number = baseSepolia.id
): Promise<Address> => {
  if (method === "bundler") {
    return deriveKernelVaultAddress(ownerAddress, chainId);
  }

  // Coinbase Smart Account — EIP-5792 path
  // toCoinbaseSmartAccount butuh typed client, jadi pilih langsung berdasarkan chainId
  const typedClient = chainId === baseSepolia.id ? publicClientSepolia : publicClient;
  const dummyOwner = toAccount({
    address: ownerAddress,
    signMessage: async () => "0x" as `0x${string}`,
    signTypedData: async () => "0x" as `0x${string}`,
    signTransaction: async () => "0x" as `0x${string}`,
  });
  const account = await toCoinbaseSmartAccount({
    client: typedClient,
    owners: [dummyOwner],
    nonce: 0n,
    version: "1",
  });
  return account.address;
};

// ─────────────────────────────────────────────────────────────────────────────
// Deteksi cara sign
// ─────────────────────────────────────────────────────────────────────────────
type SignMethod = "eip5792" | "bundler";

export const detectSignMethod = async (walletClient: WalletClient): Promise<SignMethod> => {
  try {
    await walletClient.request({ method: "wallet_getCapabilities" as any });
    console.log("[SignMethod] wallet_getCapabilities OK → EIP-5792");
    return "eip5792";
  } catch (e: any) {
    const msg = (e?.message ?? e?.details ?? "").toLowerCase();
    const code = e?.code;
    const isNotSupported =
      code === 4200 ||
      msg.includes("not supported") ||
      msg.includes("does not support") ||
      msg.includes("method not found") ||
      msg.includes("does not exist") ||
      msg.includes("is not available") ||
      msg.includes("unsupported method") ||
      msg.includes("unsupported");
    if (isNotSupported) {
      console.log("[SignMethod] EIP-5792 not supported → bundler. Reason:", e?.message);
      return "bundler";
    }
    console.log("[SignMethod] Non-fatal error, assuming EIP-5792:", e?.message);
    return "eip5792";
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Path A: EIP-5792 (Farcaster, Base App, Coinbase Wallet)
// ─────────────────────────────────────────────────────────────────────────────
const createEIP5792Client = (
  walletClient: WalletClient,
  vaultAddress: Address,
  chainId: number
): UnifiedSmartClient => ({
  account: { address: vaultAddress },
  chainId,

  sendUserOperation: async ({ calls }) => {
    const chainIdHex = `0x${chainId.toString(16)}`;
    console.log("[EIP5792] wallet_sendCalls v2.0.0, chain:", chainId, "calls:", calls.length);
    const bundleId = await walletClient.request({
      method: "wallet_sendCalls" as any,
      params: [{
        version: "2.0.0",
        chainId: chainIdHex,
        calls: calls.map((c) => ({
          to: c.to,
          value: `0x${(c.value ?? 0n).toString(16)}`,
          data: c.data || "0x",
        })),
      }],
    });
    console.log("[EIP5792] bundleId:", bundleId);
    return bundleId as `0x${string}`;
  },

  waitForUserOperationReceipt: async ({ hash }) => {
    const MAX = 60;
    for (let i = 0; i < MAX; i++) {
      try {
        const status = (await walletClient.request({
          method: "wallet_getCallsStatus" as any,
          params: [hash],
        })) as any;
        console.log(`[EIP5792] Poll ${i + 1}/${MAX}:`, status?.status);
        const done =
          status?.status === "CONFIRMED" ||
          status?.status === "confirmed" ||
          status?.statusCode === 200 ||
          status?.receipts?.length > 0;
        if (done) return { receipt: status.receipts?.[0] ?? status };
        if (status?.status === "FAILED" || status?.status === "failed")
          throw new Error("Transaction bundle failed");
      } catch (e: any) {
        if (e?.message?.includes("failed")) throw e;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Timeout: transaction not confirmed after 2 minutes");
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Path B: ZeroDev Kernel (ERC-7579) — untuk Rabby, MetaMask, OKX
// ─────────────────────────────────────────────────────────────────────────────
const createBundlerPath = async (
  walletClient: WalletClient,
  chainId: number
): Promise<UnifiedSmartClient> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  const config = getChainConfig(chainId);
  console.log(`[ZeroDev] chain=${chainId}, owner=`, walletClient.account.address);

  const { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } =
    await import("@zerodev/sdk");
  const { signerToEcdsaValidator } = await import("@zerodev/ecdsa-validator");
  const { KERNEL_V3_1 } = await import("@zerodev/sdk/constants");

  const signer = toAccount({
    address: walletClient.account.address,
    signMessage: ({ message }) =>
      walletClient.signMessage({ account: walletClient.account!, message }),
    signTypedData: (params) =>
      walletClient.signTypedData({ ...(params as any), account: walletClient.account! }),
    signTransaction: () => { throw new Error("signTransaction not supported"); },
  });

  // config.client adalah `any` — ZeroDev menerimanya tanpa type conflict
  const ecdsaValidator = await signerToEcdsaValidator(config.client, {
    signer,
    entryPoint: ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
  });

  const account = await createKernelAccount(config.client, {
    plugins: { sudo: ecdsaValidator },
    entryPoint: ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
  });

  console.log(`[ZeroDev] Kernel vault (chain ${chainId}):`, account.address);

  const paymasterClient = createZeroDevPaymasterClient({
    chain: config.chain,
    transport: http(config.paymasterRpc),
  });

  const kernelClient = createKernelAccountClient({
    account,
    chain: config.chain,
    bundlerTransport: http(config.bundlerRpc),
    paymaster: {
      getPaymasterData: (userOperation) =>
        paymasterClient.sponsorUserOperation({ userOperation }),
    },
  });

  return {
    account: { address: account.address },
    chainId,

    sendUserOperation: async ({ calls }) => {
      console.log("[ZeroDev] Sending Kernel UserOp, calls:", calls.length);
      const sanitizedCalls = calls.map((c) => ({
        to: c.to,
        value: c.value ?? 0n,
        data: (c.data ?? "0x") as `0x${string}`,
      }));
      const callData = await account.encodeCalls(sanitizedCalls);
      return kernelClient.sendUserOperation({ callData });
    },

    waitForUserOperationReceipt: async ({ hash }) => {
      console.log("[ZeroDev] Waiting for Kernel receipt:", hash);
      return kernelClient.waitForUserOperationReceipt({ hash });
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export const getSmartAccountClient = async (
  walletClient: WalletClient
): Promise<UnifiedSmartClient> => {
  if (!walletClient.account) throw new Error("Wallet not connected");

  const chainId = walletClient.chain?.id ?? baseSepolia.id;
  const isTestnet = chainId === baseSepolia.id;
  console.log(`[SmartAccount] owner=${walletClient.account.address}, chain=${chainId}${isTestnet ? " (TESTNET)" : ""}`);

  const method = await detectSignMethod(walletClient);
  console.log(`[SmartAccount] signMethod=${method}`);

  if (method === "eip5792") {
    const vaultAddress = await deriveVaultAddress(walletClient.account.address, "eip5792", chainId);
    console.log("[SmartAccount] Coinbase vault:", vaultAddress);
    return createEIP5792Client(walletClient, vaultAddress, chainId);
  }

  console.log("[SmartAccount] Using ZeroDev Kernel bundler path");
  return createBundlerPath(walletClient, chainId);
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers untuk UI
// ─────────────────────────────────────────────────────────────────────────────
export const isVaultDeployed = async (
  vaultAddress: Address,
  chainId: number = baseSepolia.id
): Promise<boolean> => {
  // Pilih typed client langsung — tidak lewat ChainConfig agar type-safe
  const client = chainId === baseSepolia.id ? publicClientSepolia : publicClient;
  const code = await client.getBytecode({ address: vaultAddress });
  return code !== undefined && code !== null && code !== "0x";
};

export const isSupportedChain = (chainId: number): boolean =>
  chainId === base.id || chainId === baseSepolia.id;

export const getChainLabel = (chainId: number): string => {
  if (chainId === baseSepolia.id) return "Base Sepolia (Testnet)";
  if (chainId === base.id) return "Base Mainnet";
  return `Unsupported Chain (${chainId})`;
};