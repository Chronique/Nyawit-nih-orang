// src/lib/smart-account.ts
//
// ✅ CDP PAYMASTER — EntryPoint v0.7 (Light Account v2.0)
//
// SPONSORED (gas-free untuk user):
//   swap, deposit morpho, withdraw morpho, wrap ETH→WETH,
//   unwrap WETH→ETH, withdrawal vault→EOA, revoke approvals
//
// NOT SPONSORED (user bayar gas sendiri):
//   deploy vault, deposit EOA→vault (walletClient.sendTransaction / writeContract)
//
// ⚠ Syarat owner:
//   EOA (MetaMask, Rabby, Farcaster custody wallet) → ✅ ECDSA langsung jalan
//   Coinbase Smart Wallet (Base App native)          → ❌ EIP-1271 tidak support
//   Solusi: di Base App, pilih injected/EOA wallet bukan Smart Wallet

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

// ── Constants ──────────────────────────────────────────────────────────────────
export const ACTIVE_CHAIN = base;
export const IS_TESTNET   = false;

const DATA_SUFFIX = Attribution.toDataSuffix({ codes: ["bc_1x8rrnnv"] });

// Factory Light Account v1.1 (EntryPoint v0.6) — vault lama, tanpa paymaster
export const FACTORY_V1 = "0x00004EC70002a32400f8ae005A26081065620D20" as Address;
// Factory Light Account v2.0 (EntryPoint v0.7) — vault baru, support CDP paymaster
export const FACTORY_V2 = "0x0000000000400CdFef5E2714E63d8040b700BC24" as Address;

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

// Light Account v2.0 — executeBatch WITH value[] (EP v0.7)
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

// ── CDP URL ───────────────────────────────────────────────────────────────────
const getCdpUrl = (): string | null => {
  const key = process.env.NEXT_PUBLIC_CDP_API_KEY;
  if (!key) {
    console.warn("[CDP] NEXT_PUBLIC_CDP_API_KEY belum di-set — transaksi TIDAK di-sponsor");
    return null;
  }
  return `https://api.developer.coinbase.com/rpc/v1/base/${key}`;
};

// ── 1. Derive vault address ───────────────────────────────────────────────────
export const deriveVaultAddress = async (
  ownerAddress: Address,
  salt    = 0n,
  factory = FACTORY_V2 as Address
): Promise<Address> => {
  return publicClient.readContract({
    address:      factory,
    abi:          FACTORY_ABI,
    functionName: "getAddress",
    args:         [ownerAddress, salt],
  });
};

// ── 2. Deteksi vault version yang sudah ter-deploy ────────────────────────────
// Dipakai komponen UI untuk display badge v1/v2 dan warning migrasi
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

  // v2 diprioritaskan — support CDP paymaster (EP v0.7)
  if (v2Deployed) {
    console.log("[LightAccount] v2.0 vault aktif:", addrV2);
    return { address: addrV2, factory: FACTORY_V2, version: "v2" };
  }

  // v1 ada tapi v2 belum — tampilkan warning di UI, operasi tetap pakai v2 address
  if (v1Deployed) {
    console.warn(
      "[LightAccount] v1.1 vault ditemukan. Paymaster tidak support v1.",
      "getSmartAccountClient akan pakai v2 address — deploy v2 dulu untuk gasless."
    );
    // Return v1 address agar UI bisa tampilkan aset lama + banner migrasi
    return { address: addrV1, factory: FACTORY_V1, version: "v1" };
  }

  // Belum ada vault — address v2 yang akan di-deploy
  console.log("[LightAccount] Belum ada vault, siap deploy v2:", addrV2);
  return { address: addrV2, factory: FACTORY_V2, version: "v2" };
};

// ── 3. Deploy vault v2 (EOA bayar gas — satu kali saja) ─────────────────────
export const deployVault = async (
  walletClient: WalletClient,
  salt = 0n
): Promise<`0x${string}`> => {
  if (!walletClient.account) throw new Error("walletClient.account is null");
  // Deploy selalu v2 untuk paymaster support
  return walletClient.writeContract({
    address:      FACTORY_V2,
    abi:          FACTORY_ABI,
    functionName: "createAccount",
    args:         [walletClient.account.address, salt],
    chain:        base,
    account:      walletClient.account,
    dataSuffix:   DATA_SUFFIX,
  });
};

// ── 4. isVaultDeployed ────────────────────────────────────────────────────────
export const isVaultDeployed = async (vaultAddress: Address): Promise<boolean> => {
  const bytecode = await publicClient.getBytecode({ address: vaultAddress });
  return !!bytecode && bytecode !== "0x";
};

// ── 5. getSmartAccountClient — mesin utama paymaster ─────────────────────────
//
// Semua operasi melalui fungsi ini GRATIS untuk user (gas dibayar CDP).
// Hanya deploy vault & deposit EOA→vault yang pakai walletClient langsung.
//
export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  const cdpUrl = getCdpUrl();

  // ── Light Account v2.0 (EntryPoint v0.7) ──────────────────────────────────
  // Selalu pakai v2 untuk CDP paymaster support.
  // Jika user masih di v1, mereka perlu deploy v2 dulu (tombol "Activate" di UI).
  const lightAccount = await toLightSmartAccount({
    client:         publicClient,
    owner:          walletClient as any, // EOA WalletClient sebagai ECDSA signer
    version:        "2.0.0",
    factoryAddress: FACTORY_V2,
    entryPoint: {
      address: entryPoint07Address, // 0x0000000071727De22E5E9d8BAf0edAc6f37da032
      version: "0.7",
    },
  });

  console.log("[CDP Paymaster] Smart Account (v2):", lightAccount.address);

  // ── DENGAN CDP Paymaster (gas gratis) ─────────────────────────────────────
  if (cdpUrl) {
    const paymasterClient = createPaymasterClient({
      transport: http(cdpUrl),
    });

    const smartAccountClient = createSmartAccountClient({
      account:          lightAccount,
      chain:            base,
      bundlerTransport: http(cdpUrl),
      paymaster:        paymasterClient,
      userOperation: {
        estimateFeesPerGas: async () => {
          // Ambil gas price dari network, bukan hardcode 0 (EP v0.7 strict)
          const fees = await publicClient.estimateFeesPerGas();
          return {
            maxFeePerGas:         fees.maxFeePerGas         ?? 2_000_000n,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 1_000_000n,
          };
        },
      },
    });

    return {
      account: { address: lightAccount.address },

      // Kirim UserOperation (sponsored — gas gratis) ─────────────────────────
      sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
        console.log(`[CDP Paymaster] ${calls.length} call(s) — SPONSORED 🎉`);
        return smartAccountClient.sendUserOperation({
          calls: calls.map((c) => ({
            to:    c.to,
            value: c.value ?? 0n,
            data:  c.data  ?? "0x",
          })),
        });
      },

      // Tunggu UserOp masuk ke blockchain ────────────────────────────────────
      waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
        console.log("[CDP Paymaster] Waiting for UserOp:", hash);
        const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash });
        return { receipt };
      },

      deployVault: () => deployVault(walletClient),
      isDeployed:  () => isVaultDeployed(lightAccount.address),
    };
  }

  // ── TANPA CDP Paymaster (fallback — hanya untuk dev local tanpa key) ──────
  // User bayar gas sendiri via direct vault contract call
  console.warn("[CDP Paymaster] Fallback mode — user bayar gas (no paymaster)");

  return {
    account: { address: lightAccount.address },

    sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
      if (!walletClient.account) throw new Error("walletClient.account is null");
      if (calls.length === 1) {
        return walletClient.writeContract({
          address:      lightAccount.address,
          abi:          LIGHT_ACCOUNT_V2_ABI,
          functionName: "execute",
          args:         [calls[0].to, calls[0].value ?? 0n, calls[0].data ?? "0x"],
          chain:        base,
          account:      walletClient.account,
          dataSuffix:   DATA_SUFFIX,
        });
      }
      return walletClient.writeContract({
        address:      lightAccount.address,
        abi:          LIGHT_ACCOUNT_V2_ABI,
        functionName: "executeBatch",
        args: [
          calls.map((c) => c.to),
          calls.map((c) => c.value ?? 0n),
          calls.map((c) => c.data  ?? "0x"),
        ],
        chain:      base,
        account:    walletClient.account,
        dataSuffix: DATA_SUFFIX,
      });
    },

    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { receipt };
    },

    deployVault: () => deployVault(walletClient),
    isDeployed:  () => isVaultDeployed(lightAccount.address),
  };
};

// ── Helper exports ────────────────────────────────────────────────────────────
export const isSupportedChain = (chainId: number): boolean =>
  chainId === base.id;

export const getChainLabel = (chainId: number): string => {
  if (chainId === base.id) return "Base";
  return `Chain ${chainId}`;
};