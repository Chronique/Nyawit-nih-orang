// src/lib/smart-account.ts
//
// ARSITEKTUR: Alchemy Light Account (ERC-4337) — user bayar gas dari EOA
//
// ⚠️ CRITICAL FIX: executeBatch ABI berbeda antara v1.1 dan v2.0
//   v1.1: executeBatch(address[] dest, bytes[] func)              ← NO value array
//   v2.0: executeBatch(address[] dest, uint256[] value, bytes[] func) ← WITH value array
//   
//   Pakai tuple[] akan generate selector SALAH → jatuh ke fallback() → REVERT

import {
  createPublicClient,
  http,
  type WalletClient,
  type Address,
  encodeFunctionData,
} from "viem";
import { base } from "viem/chains";
import { Attribution } from "ox/erc8021";

// ── Config ────────────────────────────────────────────────────────────────────
export const ACTIVE_CHAIN = base;
export const IS_TESTNET   = false;

const DATA_SUFFIX = Attribution.toDataSuffix({
  codes: ["bc_1x8rrnnv"],
});

const FACTORY_V1      = "0x00004EC70002a32400f8ae005A26081065620D20" as Address;
const FACTORY_V2      = "0x0000000000400CdFef5E2714E63d8040b700BC24" as Address;
const FACTORY_ADDRESS = FACTORY_V2; // default untuk user baru

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

// ✅ Light Account v1.1 — executeBatch TANPA value array
// Signature: executeBatch(address[],bytes[])
const LIGHT_ACCOUNT_V1_ABI = [
  {
    name: "executeBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dest", type: "address[]" },
      { name: "func", type: "bytes[]"   },
    ],
    outputs: [],
  },
  {
    name: "execute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dest",  type: "address" },
      { name: "value", type: "uint256" },
      { name: "func",  type: "bytes"   },
    ],
    outputs: [],
  },
] as const;

// ✅ Light Account v2.0 — executeBatch DENGAN value array
// Signature: executeBatch(address[],uint256[],bytes[])
const LIGHT_ACCOUNT_V2_ABI = [
  {
    name: "executeBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dest",  type: "address[]"  },
      { name: "value", type: "uint256[]"  },
      { name: "func",  type: "bytes[]"    },
    ],
    outputs: [],
  },
  {
    name: "execute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dest",  type: "address" },
      { name: "value", type: "uint256" },
      { name: "func",  type: "bytes"   },
    ],
    outputs: [],
  },
] as const;

// ── Public clients ────────────────────────────────────────────────────────────
export const publicClient = createPublicClient({
  chain: base,
  transport: http(`https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
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
  factory: Address = FACTORY_ADDRESS
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
export const deployVault = async (
  walletClient: WalletClient,
  salt = 0n
): Promise<`0x${string}`> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");
  return walletClient.writeContract({
    address:      FACTORY_ADDRESS,
    abi:          FACTORY_ABI,
    functionName: "createAccount",
    args:         [walletClient.account.address, salt],
    chain:        base,
    account:      walletClient.account,
    dataSuffix: DATA_SUFFIX,
  });
};

// ── 4. sendBatch — encode sesuai versi vault ──────────────────────────────────
// v1.1: executeBatch(address[], bytes[])           ← value TIDAK dikirim (semua 0)
// v2.0: executeBatch(address[], uint256[], bytes[]) ← value dikirim per call
export const sendBatch = async (
  walletClient:  WalletClient,
  vaultAddress:  Address,
  calls:         VaultCall[],
  vaultVersion:  "v1" | "v2" = "v2"
): Promise<`0x${string}`> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  if (vaultVersion === "v1") {
    // v1.1: tidak support value per-call di executeBatch
    // Kalau ada call dengan value > 0 → harus pakai execute (single)
    const hasValue = calls.some(c => (c.value ?? 0n) > 0n);
    if (hasValue && calls.length === 1) {
      console.log("[LightAccount v1] single call with value → execute()");
      return walletClient.writeContract({
        address:      vaultAddress,
        abi:          LIGHT_ACCOUNT_V1_ABI,
        functionName: "execute",
        args:         [calls[0].to, calls[0].value ?? 0n, calls[0].data ?? "0x"],
        chain:        base,
        account:      walletClient.account,
        dataSuffix: DATA_SUFFIX,
      });
    }
    console.log("[LightAccount v1] executeBatch, calls:", calls.length);
    return walletClient.writeContract({
      address:      vaultAddress,
      abi:          LIGHT_ACCOUNT_V1_ABI,
      functionName: "executeBatch",
      args: [
        calls.map(c => c.to),
        calls.map(c => c.data ?? "0x"),
      ],
      chain:   base,
      account: walletClient.account,
      dataSuffix: DATA_SUFFIX,
    });
  }

  // v2.0: support value per-call
  console.log("[LightAccount v2] executeBatch, calls:", calls.length);
  return walletClient.writeContract({
    address:      vaultAddress,
    abi:          LIGHT_ACCOUNT_V2_ABI,
    functionName: "executeBatch",
    args: [
      calls.map(c => c.to),
      calls.map(c => c.value ?? 0n),
      calls.map(c => c.data ?? "0x"),
    ],
    chain:   base,
    account: walletClient.account,
    dataSuffix: DATA_SUFFIX,
  });
};

// ── 5. sendSingle ─────────────────────────────────────────────────────────────
// execute() sama di v1 dan v2
export const sendSingle = async (
  walletClient: WalletClient,
  vaultAddress: Address,
  call:         VaultCall,
  vaultVersion: "v1" | "v2" = "v2"
): Promise<`0x${string}`> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");
  const abi = vaultVersion === "v1" ? LIGHT_ACCOUNT_V1_ABI : LIGHT_ACCOUNT_V2_ABI;
  return walletClient.writeContract({
    address:      vaultAddress,
    abi,
    functionName: "execute",
    args:         [call.to, call.value ?? 0n, call.data ?? "0x"],
    chain:        base,
    account:      walletClient.account,
    dataSuffix: DATA_SUFFIX,
  });
};

// ── 6. Helper functions ───────────────────────────────────────────────────────
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

// ── 7. Unified client ─────────────────────────────────────────────────────────
// Interface sama dengan sebelumnya: sendUserOperation + waitForUserOperationReceipt
export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  const { address: vaultAddress, factory: vaultFactory, version: vaultVersion } =
    await detectVaultAddress(walletClient.account.address);

  console.log("[LightAccount] Vault address:", vaultAddress);
  console.log("[LightAccount] Chain: Base");
  console.log("[LightAccount] Factory version:", vaultVersion);

  return {
    account: { address: vaultAddress },

    sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
      if (calls.length === 1) {
        return sendSingle(walletClient, vaultAddress, calls[0], vaultVersion);
      }
      return sendBatch(walletClient, vaultAddress, calls, vaultVersion);
    },

    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      console.log("[LightAccount] Waiting for tx:", hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { receipt };
    },

    deployVault: () => deployVault(walletClient),
    isDeployed:  () => isVaultDeployed(vaultAddress),
  };
};