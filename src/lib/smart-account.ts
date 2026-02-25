// src/lib/smart-account.ts
//
// TIGA MODE CLIENT:
// ┌──────────────────────────────────┬─────────────────────────────────────────┐
// │ getSmartAccountClient()          │ SPONSORED via CDP Paymaster (gratis)    │
// │                                  │ wrap/unwrap, morpho, withdraw, GM       │
// ├──────────────────────────────────┼─────────────────────────────────────────┤
// │ getSelfPayingSmartAccountClient()│ UserOp via bundler, vault bayar gas     │
// │                                  │ revoke approvals                        │
// ├──────────────────────────────────┼─────────────────────────────────────────┤
// │ getDirectVaultClient()           │ EOA direct tx — swap dust tokens        │
// └──────────────────────────────────┴─────────────────────────────────────────┘

import {
  createPublicClient,
  http,
  type WalletClient,
  type Address,
} from "viem";
import { base } from "viem/chains";
import {
  entryPoint07Address,
  createPaymasterClient,
} from "viem/account-abstraction";
import { toLightSmartAccount } from "permissionless/accounts";
import { createSmartAccountClient } from "permissionless";
import { Attribution } from "ox/erc8021";

export const ACTIVE_CHAIN = base;
export const IS_TESTNET   = false;

const DATA_SUFFIX = Attribution.toDataSuffix({ codes: ["bc_1x8rrnnv"] });

export const FACTORY_V1 = "0x00004EC70002a32400f8ae005A26081065620D20" as Address;
export const FACTORY_V2 = "0x0000000000400CdFef5E2714E63d8040b700BC24" as Address;

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

const LIGHT_ACCOUNT_V2_ABI = [
  {
    name: "executeBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dest",  type: "address[]" },
      { name: "value", type: "uint256[]" },
      { name: "func",  type: "bytes[]"   },
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

export const publicClient = createPublicClient({
  chain: base,
  transport: http(
    `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
  ),
});

export interface VaultCall {
  to:    Address;
  value: bigint;
  data:  `0x${string}`;
}

const getCdpUrl = (): string | null => {
  const key = process.env.NEXT_PUBLIC_CDP_API_KEY;
  if (!key) { console.warn("[CDP] NEXT_PUBLIC_CDP_API_KEY not set"); return null; }
  return `https://api.developer.coinbase.com/rpc/v1/base/${key}`;
};

export const deriveVaultAddress = async (
  ownerAddress: Address,
  salt    = 0n,
  factory = FACTORY_V2 as Address
): Promise<Address> => {
  return publicClient.readContract({
    address: factory, abi: FACTORY_ABI, functionName: "getAddress",
    args: [ownerAddress, salt],
  });
};

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
  if (v2Deployed) return { address: addrV2, factory: FACTORY_V2, version: "v2" };
  if (v1Deployed) return { address: addrV1, factory: FACTORY_V1, version: "v1" };
  return { address: addrV2, factory: FACTORY_V2, version: "v2" };
};

export const deployVault = async (
  walletClient: WalletClient,
  salt = 0n
): Promise<`0x${string}`> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");
  return walletClient.writeContract({
    address: FACTORY_V2, abi: FACTORY_ABI, functionName: "createAccount",
    args: [walletClient.account.address, salt],
    chain: base, account: walletClient.account, dataSuffix: DATA_SUFFIX,
  });
};

export const isVaultDeployed = async (vaultAddress: Address): Promise<boolean> => {
  const bytecode = await publicClient.getBytecode({ address: vaultAddress });
  return !!bytecode && bytecode !== "0x";
};

async function getLightAccount(walletClient: WalletClient) {
  return toLightSmartAccount({
    client: publicClient, owner: walletClient as any, version: "2.0.0",
    factoryAddress: FACTORY_V2,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });
}

// ── buildDirectClient — EOA direct (hanya untuk swap dust / fallback) ─────────
// ⚠ LightAccount v2: execute() hanya bisa dipanggil EntryPoint.
//   Direct EOA call → revert #1002. Gunakan hanya untuk swap (writeContract
//   langsung ke token ERC20, bukan ke vault.execute).
function buildDirectClient(walletClient: WalletClient, vaultAddress: Address) {
  return {
    account:    { address: vaultAddress },
    _sponsored: false,
    sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
      if (!walletClient.account) throw new Error("walletClient.account is null");
      console.log(`[Direct] ${calls.length} call(s) — EOA direct`);
      if (calls.length === 1) {
        return walletClient.writeContract({
          address: vaultAddress, abi: LIGHT_ACCOUNT_V2_ABI, functionName: "execute",
          args: [calls[0]!.to, calls[0]!.value ?? 0n, calls[0]!.data ?? "0x"],
          chain: base, account: walletClient.account, dataSuffix: DATA_SUFFIX,
        });
      }
      return walletClient.writeContract({
        address: vaultAddress, abi: LIGHT_ACCOUNT_V2_ABI, functionName: "executeBatch",
        args: [calls.map(c => c.to), calls.map(c => c.value ?? 0n), calls.map(c => c.data ?? "0x")],
        chain: base, account: walletClient.account, dataSuffix: DATA_SUFFIX,
      });
    },
    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { receipt };
    },
    deployVault: () => deployVault(walletClient),
    isDeployed:  () => isVaultDeployed(vaultAddress),
  };
}

// ── getSmartAccountClient — SPONSORED via CDP Paymaster ───────────────────────
export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");
  const cdpUrl       = getCdpUrl();
  const lightAccount = await getLightAccount(walletClient);
  console.log("[CDP] Smart Account v2:", lightAccount.address);
  if (cdpUrl) {
    const paymasterClient = createPaymasterClient({ transport: http(cdpUrl) });
    const sponsoredClient = createSmartAccountClient({
      account: lightAccount, chain: base,
      bundlerTransport: http(cdpUrl),
      paymaster: paymasterClient,
    });
    return {
      account:    { address: lightAccount.address },
      _sponsored: true,
      sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
        console.log(`[CDP] ${calls.length} call(s) — SPONSORED 🎉`);
        return sponsoredClient.sendUserOperation({
          calls: calls.map(c => ({ to: c.to, value: c.value ?? 0n, data: c.data ?? "0x" })),
        });
      },
      waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
        console.log("[CDP] Waiting for UserOp:", hash);
        const receipt = await sponsoredClient.waitForUserOperationReceipt({ hash });
        return { receipt };
      },
      deployVault: () => deployVault(walletClient),
      isDeployed:  () => isVaultDeployed(lightAccount.address),
    };
  }
  console.warn("[CDP] Fallback ke direct (no key)");
  return buildDirectClient(walletClient, lightAccount.address);
};

// ── getSelfPayingSmartAccountClient — UserOp, vault bayar gas sendiri ─────────
//
// Untuk operasi yang:
//   ✗ Paymaster reject (approve token random)
//   ✗ Direct EOA call revert #1002 (LightAccount v2 butuh EntryPoint)
//   ✓ Vault punya ETH (~0.0001 ETH cukup di Base)
//
// Contoh: revoke approvals
//
export const getSelfPayingSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");
  const cdpUrl       = getCdpUrl();
  const lightAccount = await getLightAccount(walletClient);
  if (!cdpUrl) throw new Error("[SelfPay] CDP_API_KEY not set");

  // Sama seperti sponsored client tapi TANPA paymaster
  // Bundler tetap CDP, vault bayar gas dari ETH balance sendiri
  const selfPayClient = createSmartAccountClient({
    account: lightAccount, chain: base,
    bundlerTransport: http(cdpUrl),
    // Tidak ada `paymaster` — vault bayar sendiri
  });

  console.log("[SelfPay] Vault pays own gas:", lightAccount.address);
  return {
    account:    { address: lightAccount.address },
    _sponsored: false,
    sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
      console.log(`[SelfPay] ${calls.length} call(s) — vault bayar gas sendiri`);
      return selfPayClient.sendUserOperation({
        calls: calls.map(c => ({ to: c.to, value: c.value ?? 0n, data: c.data ?? "0x" })),
      });
    },
    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      const receipt = await selfPayClient.waitForUserOperationReceipt({ hash });
      return { receipt };
    },
    deployVault: () => deployVault(walletClient),
    isDeployed:  () => isVaultDeployed(lightAccount.address),
  };
};

// ── getDirectVaultClient — swap dust tokens (approve random ERC20) ─────────────
export const getDirectVaultClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");
  const lightAccount = await getLightAccount(walletClient);
  console.log("[Direct] Swap client:", lightAccount.address);
  return buildDirectClient(walletClient, lightAccount.address);
};

export const isSupportedChain = (chainId: number): boolean => chainId === base.id;
export const getChainLabel = (chainId: number): string => {
  if (chainId === base.id) return "Base";
  return `Chain ${chainId}`;
};