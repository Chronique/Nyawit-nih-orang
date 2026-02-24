// src/lib/smart-account.ts
//
// ARSITEKTUR: EIP-4337 UserOperations via permissionless.js + CDP Paymaster
//
// Flow baru:
//   EOA (sign saja, tidak butuh ETH)
//     → UserOperation
//       → CDP Bundler + Paymaster (bayar gas dari saldo CDP)
//         → EntryPoint
//           → Light Account (execute calls)
//
// Kompatibel dengan:
//   - Light Account v1.1 (EntryPoint v0.6)  ← user yang sudah deploy v1
//   - Light Account v2.0 (EntryPoint v0.7)  ← user baru / default
//
// Interface TIDAK berubah — semua view komponen tetap jalan tanpa edit.

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

// CDP Paymaster URL dari .env
// Format: https://api.developer.coinbase.com/rpc/v1/base/YOUR_API_KEY
const CDP_URL = process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL!;

// ── Factory addresses (Alchemy Light Account) ─────────────────────────────────
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

// ── Public client (Alchemy RPC untuk read) ─────────────────────────────────────
export const publicClient = createPublicClient({
  chain: base,
  transport: http(
    `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
  ),
});

// ── CDP Paymaster client ───────────────────────────────────────────────────────
// CDP URL double fungsi: bundler + paymaster dalam 1 endpoint
const paymasterClient = createPaymasterClient({
  transport: http(CDP_URL),
});

// ── Types ─────────────────────────────────────────────────────────────────────
export interface VaultCall {
  to:    Address;
  value: bigint;
  data:  `0x${string}`;
}

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

  const v1Deployed = !!codeV1 && codeV1 !== "0x";
  const v2Deployed = !!codeV2 && codeV2 !== "0x";

  if (v1Deployed) {
    console.log("[LightAccount] Using v1.1 vault:", addrV1);
    return { address: addrV1, factory: FACTORY_V1, version: "v1" };
  }
  if (v2Deployed) {
    console.log("[LightAccount] Using v2.0 vault:", addrV2);
    return { address: addrV2, factory: FACTORY_V2, version: "v2" };
  }

  console.log("[LightAccount] No vault deployed yet, will use v2:", addrV2);
  return { address: addrV2, factory: FACTORY_V2, version: "v2" };
};

// ── 3. Deploy vault ───────────────────────────────────────────────────────────
// Deploy tetap pakai regular tx dari EOA (hanya dilakukan 1x)
// Setelah deploy, semua operasi selanjutnya via userOperation (gasless)
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

// ── 4. Helper functions ───────────────────────────────────────────────────────
export const isVaultDeployed = async (vaultAddress: Address): Promise<boolean> => {
  const bytecode = await publicClient.getBytecode({ address: vaultAddress });
  return !!bytecode && bytecode !== "0x";
};

export const isSupportedChain = (chainId: number): boolean =>
  chainId === base.id;

export const getChainLabel = (chainId: number): string => {
  if (chainId === base.id) return "Base";
  return `Chain ${chainId}`;
};

// ── 5. Unified client (EIP-4337 via CDP Paymaster) ───────────────────────────
//
// Interface SAMA dengan versi sebelumnya:
//   client.account.address         → vault address
//   client.sendUserOperation({ calls }) → kirim via bundler, gas dibayar CDP
//   client.waitForUserOperationReceipt({ hash }) → tunggu konfirmasi
//
export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  const ownerAddress = walletClient.account.address as Address;

  // Detect vault version untuk pilih EntryPoint yang benar
  const { address: vaultAddress, version: vaultVersion } =
    await detectVaultAddress(ownerAddress);

  // Wrap walletClient jadi LocalAccount-compatible
  // JsonRpcAccount (MetaMask dll) tidak punya signTransaction, perlu di-wrap
  const owner = toAccount({
    address: ownerAddress,
    async signMessage({ message }) {
      return walletClient.signMessage({
        account: walletClient.account!,
        message,
      });
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

  // Build Light Account sesuai versi
  // v1.1 → EntryPoint 0.6 | v2.0 → EntryPoint 0.7
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
  console.log("[EIP-4337] Entry point version:", vaultVersion === "v1" ? "0.6" : "0.7");
  console.log("[EIP-4337] Paymaster: CDP");

  // Buat Smart Account Client dengan CDP sebagai bundler + paymaster
  const bundlerClient = createSmartAccountClient({
    account:          lightAccount,
    chain:            base,
    bundlerTransport: http(CDP_URL),   // CDP sebagai bundler
    paymaster:        paymasterClient, // CDP sebagai paymaster (sponsor gas)
    userOperation: {
      estimateFeesPerGas: async () => {
        // Biarkan bundler estimate fee
        return { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };
      },
    },
  });

  return {
    // ✅ Kompatibel dengan kode lama
    account: { address: vaultAddress },

    // ✅ sendUserOperation — sekarang beneran EIP-4337, gas dibayar CDP
    sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
      console.log(`[EIP-4337] Sending ${calls.length} call(s) via CDP Paymaster`);
      const hash = await bundlerClient.sendUserOperation({ calls });
      console.log("[EIP-4337] UserOperation hash:", hash);
      return hash;
    },

    // ✅ waitForUserOperationReceipt — tunggu userOp masuk chain
    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      console.log("[EIP-4337] Waiting for userOp receipt:", hash);
      const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
      return { receipt };
    },

    // ✅ Helper functions tetap ada
    deployVault: () => deployVault(walletClient),
    isDeployed:  () => isVaultDeployed(vaultAddress),
  };
};