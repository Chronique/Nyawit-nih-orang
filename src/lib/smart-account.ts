// src/lib/smart-account.ts
//
// ARSITEKTUR: Alchemy Light Account (ERC-4337) — user bayar gas dari EOA
//
// Flow:
// 1. deriveVaultAddress(owner) → alamat deterministik dari factory
// 2. deployVault(walletClient)  → EOA deploy via factory, bayar gas dari EOA
// 3. sendBatch(walletClient, calls) → EOA call executeBatch() di vault
//
// Tidak ada bundler, tidak ada UserOp, tidak ada paymaster.
// Gas selalu dari wallet owner (EOA).
//
// MULTI-CHAIN: ganti chain + factory address → support semua EVM

import {
  createPublicClient,
  http,
  type WalletClient,
  type Address,
  encodeFunctionData,
} from "viem";
import { base, baseSepolia } from "viem/chains";

// ── Config ────────────────────────────────────────────────────────────────────
// Ganti ke base untuk mainnet, baseSepolia untuk testing
export const ACTIVE_CHAIN = baseSepolia;
export const IS_TESTNET = ACTIVE_CHAIN.id === baseSepolia.id;

// Alchemy Light Account Factory
// Source: https://github.com/alchemyplatform/light-account
// Sama di semua chain yang support
const FACTORY_ADDRESS = "0x00004EC70002a32400f8ae005A26081065620D20" as Address;

const RPC_URL = IS_TESTNET
  ? `https://base-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
  : `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`;

// ── ABIs ──────────────────────────────────────────────────────────────────────
const FACTORY_ABI = [
  {
    name: "getAddress",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "createAccount",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "ret", type: "address" }],
  },
] as const;

const LIGHT_ACCOUNT_ABI = [
  // executeBatch: jalankan multiple calls atomic dalam 1 transaksi
  {
    name: "executeBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  // execute: single call
  {
    name: "execute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// ── Public clients ────────────────────────────────────────────────────────────
export const publicClient = createPublicClient({
  chain: base,
  transport: http(`https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
});

export const publicClientSepolia = createPublicClient({
  chain: baseSepolia,
  transport: http(`https://base-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
});

// ── Chain helpers ─────────────────────────────────────────────────────────────
const SUPPORTED_CHAIN_IDS: number[] = [base.id, baseSepolia.id];

export const isSupportedChain = (chainId: number): boolean =>
  SUPPORTED_CHAIN_IDS.includes(chainId);

export const getChainLabel = (chainId: number): string => {
  if (chainId === baseSepolia.id) return "Base Sepolia";
  if (chainId === base.id) return "Base";
  return `Chain ${chainId}`;
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface VaultCall {
  to: Address;
  value: bigint;
  data: `0x${string}`;
}

// ── 1. Derive vault address (tanpa deploy) ────────────────────────────────────
// Deterministik: sama owner + salt = sama address, selamanya, di semua chain
export const deriveVaultAddress = async (
  ownerAddress: Address,
  salt = 0n,
  chainId?: number
): Promise<Address> => {
  const client = chainId === baseSepolia.id ? publicClientSepolia : publicClient;
  const address = await client.readContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getAddress",
    args: [ownerAddress, salt],
  });
  return address as Address;
};

// ── 2. Cek apakah vault sudah di-deploy ──────────────────────────────────────
export const isVaultDeployed = async (vaultAddress: Address, chainId?: number): Promise<boolean> => {
  const client = chainId === baseSepolia.id ? publicClientSepolia : publicClient;
  const bytecode = await client.getBytecode({ address: vaultAddress });
  return !!bytecode && bytecode !== "0x";
};

// ── 3. Deploy vault — EOA bayar gas langsung ──────────────────────────────────
// Dipanggil sekali saja. Setelah ini vault aktif selamanya.
export const deployVault = async (
  walletClient: WalletClient,
  salt = 0n
): Promise<`0x${string}`> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  const txHash = await walletClient.writeContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "createAccount",
    args: [walletClient.account.address, salt],
    chain: ACTIVE_CHAIN,
    account: walletClient.account,
  });

  return txHash;
};

// ── 4. Send batch — EOA call executeBatch di vault ───────────────────────────
// Ini pengganti sendUserOperation. Sama hasilnya: atomic multi-call.
// Gas dari EOA, tidak perlu ETH di dalam vault.
export const sendBatch = async (
  walletClient: WalletClient,
  vaultAddress: Address,
  calls: VaultCall[]
): Promise<`0x${string}`> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  // Sanitize
  const sanitized = calls.map((c) => ({
    target: c.to,
    value: c.value ?? 0n,
    data: (c.data ?? "0x") as `0x${string}`,
  }));

  console.log("[LightAccount] executeBatch, calls:", sanitized.length);

  const txHash = await walletClient.writeContract({
    address: vaultAddress,
    abi: LIGHT_ACCOUNT_ABI,
    functionName: "executeBatch",
    args: [sanitized],
    chain: ACTIVE_CHAIN,
    account: walletClient.account,
  });

  return txHash;
};

// ── 5. Single execute (withdraw, dll) ────────────────────────────────────────
export const sendSingle = async (
  walletClient: WalletClient,
  vaultAddress: Address,
  call: VaultCall
): Promise<`0x${string}`> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  const txHash = await walletClient.writeContract({
    address: vaultAddress,
    abi: LIGHT_ACCOUNT_ABI,
    functionName: "execute",
    args: [call.to, call.value ?? 0n, (call.data ?? "0x") as `0x${string}`],
    chain: ACTIVE_CHAIN,
    account: walletClient.account,
  });

  return txHash;
};

// ── 6. Unified client (kompatibel dengan deposit/vault/swap view) ─────────────
// Wrapper agar deposit-view, vault-view, swap-view tidak perlu banyak diubah
// Interface sama dengan sebelumnya: sendUserOperation + waitForUserOperationReceipt
export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  // Pilih publicClient sesuai chain wallet
  const chainId = walletClient.chain?.id ?? ACTIVE_CHAIN.id;
  const activePublicClient = chainId === baseSepolia.id ? publicClientSepolia : publicClient;
  const activeChain = chainId === baseSepolia.id ? baseSepolia : base;

  const vaultAddress = await deriveVaultAddress(walletClient.account.address);

  console.log("[LightAccount] Vault address:", vaultAddress);
  console.log("[LightAccount] Chain:", activeChain.name);

  return {
    account: { address: vaultAddress },

    sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
      // Override chain di setiap call agar sesuai chain wallet
      const callsWithChain = calls.map((c) => ({ ...c }));
      if (callsWithChain.length === 1) {
        return sendSingle(walletClient, vaultAddress, callsWithChain[0]);
      }
      return sendBatch(walletClient, vaultAddress, callsWithChain);
    },

    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      console.log("[LightAccount] Waiting for tx:", hash);
      const receipt = await activePublicClient.waitForTransactionReceipt({ hash });
      return { receipt };
    },

    deployVault: () => deployVault(walletClient),
    isDeployed: () => isVaultDeployed(vaultAddress),
  };
};
