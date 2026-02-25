// src/lib/smart-account.ts
//
// ARSITEKTUR: EIP-4337 UserOperations via permissionless.js + CDP Paymaster
//
// Flow:
//   EOA (sign saja, tidak butuh ETH)
//     → UserOperation
//       → CDP Bundler + Paymaster (bayar gas dari saldo CDP)
//         → EntryPoint → Light Account
//
// ✅ Auto-detect: plain ETH transfer → skip paymaster (CDP tidak bisa sponsor)
//    Contract calls → pakai paymaster (gasless)

import {
  createPublicClient,
  http,
  type WalletClient,
  type Address,
} from "viem";
import { toAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  createPaymasterClient,
  entryPoint06Address,
  entryPoint07Address,
} from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { toLightSmartAccount } from "permissionless/accounts";

// ── Config ────────────────────────────────────────────────────────────────────
export const ACTIVE_CHAIN = base;
export const IS_TESTNET   = false;

// ── Factory addresses ─────────────────────────────────────────────────────────
const FACTORY_V1 = "0x00004EC70002a32400f8ae005A26081065620D20" as Address;
const FACTORY_V2 = "0x0000000000400CdFef5E2714E63d8040b700BC24" as Address;

// ── ABIs ──────────────────────────────────────────────────────────────────────
const FACTORY_ABI = [
  {
    name: "getAddress",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "owner", type: "address" }, { name: "salt", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "createAccount",
    type: "function",
    stateMutability: "nonpayable",
    inputs:  [{ name: "owner", type: "address" }, { name: "salt", type: "uint256" }],
    outputs: [{ name: "ret", type: "address" }],
  },
] as const;

// ── Public client ─────────────────────────────────────────────────────────────
export const publicClient = createPublicClient({
  chain: base,
  transport: http(
    `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
  ),
});

// ── Types ─────────────────────────────────────────────────────────────────────
export interface VaultCall {
  to:    Address;
  value: bigint;
  data:  `0x${string}`;
}

// ── Helper: apakah call ini adalah plain ETH transfer? ────────────────────────
// CDP Paymaster tidak bisa sponsor transfer ETH ke EOA (address tidak di allowlist)
// Plain ETH transfer = value > 0 DAN data kosong ("0x" atau "")
const isPlainEthTransfer = (calls: VaultCall[]): boolean =>
  calls.every(c => (c.value ?? 0n) > 0n && (!c.data || c.data === "0x"));

// ── 1. Derive vault address ───────────────────────────────────────────────────
export const deriveVaultAddress = async (
  ownerAddress: Address,
  salt = 0n,
  factory: Address = FACTORY_V2
): Promise<Address> => {
  return publicClient.readContract({
    address:      factory,
    abi:          FACTORY_ABI,
    functionName: "getAddress",
    args:         [ownerAddress, salt],
  });
};

// ── 2. Auto-detect vault version ──────────────────────────────────────────────
export const detectVaultAddress = async (
  ownerAddress: Address,
  salt = 0n
): Promise<{ address: Address; factory: Address; version: "v1" | "v2" }> => {
  const [addrV1, addrV2] = await Promise.all([
    deriveVaultAddress(ownerAddress, salt, FACTORY_V1),
    deriveVaultAddress(ownerAddress, salt, FACTORY_V2),
  ]);

  const [codeV1, codeV2] = await Promise.all([
    publicClient.getBytecode({ address: addrV1 }),
    publicClient.getBytecode({ address: addrV2 }),
  ]);

  if (!!codeV1 && codeV1 !== "0x") {
    console.log("[LightAccount] v1.1:", addrV1);
    return { address: addrV1, factory: FACTORY_V1, version: "v1" };
  }
  if (!!codeV2 && codeV2 !== "0x") {
    console.log("[LightAccount] v2.0:", addrV2);
    return { address: addrV2, factory: FACTORY_V2, version: "v2" };
  }

  console.log("[LightAccount] Not deployed yet, will use v2:", addrV2);
  return { address: addrV2, factory: FACTORY_V2, version: "v2" };
};

// ── 3. Deploy vault (regular tx dari EOA, 1x saja) ───────────────────────────
export const deployVault = async (
  walletClient: WalletClient,
  salt = 0n
): Promise<`0x${string}`> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");
  return walletClient.writeContract({
    address:      FACTORY_V2,
    abi:          FACTORY_ABI,
    functionName: "createAccount",
    args:         [walletClient.account.address, salt],
    chain:        base,
    account:      walletClient.account,
  });
};

// ── 4. Helpers ────────────────────────────────────────────────────────────────
export const isVaultDeployed = async (vaultAddress: Address): Promise<boolean> => {
  const bytecode = await publicClient.getBytecode({ address: vaultAddress });
  return !!bytecode && bytecode !== "0x";
};

export const isSupportedChain = (chainId: number): boolean => chainId === base.id;

export const getChainLabel = (chainId: number): string => {
  if (chainId === base.id) return "Base";
  return `Chain ${chainId}`;
};

// ── 5. Smart Account Client (EIP-4337 + CDP Paymaster) ───────────────────────
//
// Dua mode otomatis:
//   1. Contract call  → pakai CDP Paymaster (gasless ✅)
//   2. Plain ETH transfer → skip paymaster, user bayar gas sendiri
//      (CDP tidak bisa sponsor transfer ke EOA dynamic)
//
export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  // ✅ Baca env di DALAM fungsi — bukan module level
  const cdpUrl = process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL;
  if (!cdpUrl) throw new Error(
    "NEXT_PUBLIC_CDP_PAYMASTER_URL is not set in .env\n" +
    "Format: https://api.developer.coinbase.com/rpc/v1/base/${key}"
  );

  const ownerAddress = walletClient.account.address as Address;

  // Detect versi vault → pilih EntryPoint
  const { address: vaultAddress, version: vaultVersion } =
    await detectVaultAddress(ownerAddress);

  // Wrap JsonRpcAccount (MetaMask/wagmi) → LocalAccount
  const owner = toAccount({
    address: ownerAddress,
    async signMessage({ message }) {
      return walletClient.signMessage({ account: walletClient.account!, message });
    },
    async signTransaction(transaction) {
      return walletClient.signTransaction({
        account: walletClient.account!,
        ...transaction,
        chain: base,
      } as any);
    },
    async signTypedData(typedData) {
      return walletClient.signTypedData({
        account: walletClient.account!,
        ...(typedData as any),
      });
    },
  });

  // Build Light Account
  const lightAccount = await toLightSmartAccount({
    client:         publicClient,
    owner,
    version:        vaultVersion === "v1" ? "1.1.0" : "2.0.0",
    factoryAddress: vaultVersion === "v1" ? FACTORY_V1 : FACTORY_V2,
    entryPoint: {
      address: vaultVersion === "v1" ? entryPoint06Address : entryPoint07Address,
      version: vaultVersion === "v1" ? "0.6" : "0.7",
    },
  });

  console.log("[EIP-4337] Vault:", vaultAddress);
  console.log("[EIP-4337] EntryPoint:", vaultVersion === "v1" ? "v0.6" : "v0.7");

  // ── Client WITH paymaster (untuk contract calls — gasless) ──────────────────
  const paymasterClient = createPaymasterClient({
    transport: http(cdpUrl),
  });

  const clientWithPaymaster = createSmartAccountClient({
    account:          lightAccount,
    chain:            base,
    bundlerTransport: http(cdpUrl),
    paymaster:        paymasterClient,
    userOperation: {
      estimateFeesPerGas: async () => ({
        maxFeePerGas:         0n,
        maxPriorityFeePerGas: 0n,
      }),
    },
  });

  // ── Client WITHOUT paymaster (untuk plain ETH transfer — user bayar gas) ────
  // Gas sangat kecil di Base (~$0.001), acceptable untuk withdraw ETH
  const clientNoPaymaster = createSmartAccountClient({
    account:          lightAccount,
    chain:            base,
    bundlerTransport: http(cdpUrl), // tetap pakai CDP sebagai bundler
    // tanpa paymaster → user/vault yang bayar gas
    userOperation: {
      estimateFeesPerGas: async () => ({
        maxFeePerGas:         0n,
        maxPriorityFeePerGas: 0n,
      }),
    },
  });

  return {
    account: { address: vaultAddress },

    // ✅ Auto-detect: pilih client yang tepat berdasarkan jenis call
    sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
      const ethTransfer = isPlainEthTransfer(calls);

      if (ethTransfer) {
        // Plain ETH transfer ke EOA → skip paymaster
        // CDP tidak bisa sponsor karena alamat tujuan dynamic (tidak di allowlist)
        console.log("[EIP-4337] Plain ETH transfer → skipping paymaster");
        const hash = await clientNoPaymaster.sendUserOperation({ calls });
        console.log("[EIP-4337] UserOp hash (no paymaster):", hash);
        return hash;
      }

      // Contract call → pakai paymaster (gasless)
      console.log(`[EIP-4337] Contract call (${calls.length} calls) → CDP Paymaster`);
      const hash = await clientWithPaymaster.sendUserOperation({ calls });
      console.log("[EIP-4337] UserOp hash (gasless):", hash);
      return hash;
    },

    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      console.log("[EIP-4337] Waiting for receipt:", hash);
      // Coba dengan paymaster client dulu (bisa handle keduanya)
      const receipt = await clientWithPaymaster.waitForUserOperationReceipt({ hash });
      return { receipt };
    },

    deployVault: () => deployVault(walletClient),
    isDeployed:  () => isVaultDeployed(vaultAddress),
  };
};

// ── 6. Direct Vault Client (tanpa paymaster) ──────────────────────────────────
//
// Dipakai oleh batch-swap.ts untuk operasi swap:
//   - approve() ke token ERC20 sembarang → CDP tidak bisa whitelist dynamic
//   - swap via aggregator → address router bisa berubah
//
// Gas dibayar oleh vault sendiri (harus ada sedikit ETH sebagai gas reserve)
// Gas di Base sangat murah (~$0.01 per batch swap)
//
export const getDirectVaultClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  const cdpUrl = process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL;
  if (!cdpUrl) throw new Error("NEXT_PUBLIC_CDP_PAYMASTER_URL is not set in .env");

  const ownerAddress = walletClient.account.address as Address;

  const { address: vaultAddress, version: vaultVersion } =
    await detectVaultAddress(ownerAddress);

  const owner = toAccount({
    address: ownerAddress,
    async signMessage({ message }) {
      return walletClient.signMessage({ account: walletClient.account!, message });
    },
    async signTransaction(transaction) {
      return walletClient.signTransaction({
        account: walletClient.account!,
        ...transaction,
        chain: base,
      } as any);
    },
    async signTypedData(typedData) {
      return walletClient.signTypedData({
        account: walletClient.account!,
        ...(typedData as any),
      });
    },
  });

  const lightAccount = await toLightSmartAccount({
    client:         publicClient,
    owner,
    version:        vaultVersion === "v1" ? "1.1.0" : "2.0.0",
    factoryAddress: vaultVersion === "v1" ? FACTORY_V1 : FACTORY_V2,
    entryPoint: {
      address: vaultVersion === "v1" ? entryPoint06Address : entryPoint07Address,
      version: vaultVersion === "v1" ? "0.6" : "0.7",
    },
  });

  console.log("[DirectVault] No paymaster — vault pays gas");
  console.log("[DirectVault] Vault:", vaultAddress);

  // Tanpa paymaster — vault sendiri yang bayar gas
  const directClient = createSmartAccountClient({
    account:          lightAccount,
    chain:            base,
    bundlerTransport: http(cdpUrl),
    userOperation: {
      estimateFeesPerGas: async () => ({
        maxFeePerGas:         0n,
        maxPriorityFeePerGas: 0n,
      }),
    },
  });

  return {
    account: { address: vaultAddress },

    sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
      console.log(`[DirectVault] Sending ${calls.length} call(s), no paymaster`);
      const hash = await directClient.sendUserOperation({ calls });
      console.log("[DirectVault] UserOp hash:", hash);
      return hash;
    },

    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      const receipt = await directClient.waitForUserOperationReceipt({ hash });
      return { receipt };
    },

    deployVault: () => deployVault(walletClient),
    isDeployed:  () => isVaultDeployed(vaultAddress),
  };
};