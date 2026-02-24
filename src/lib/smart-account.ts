// src/lib/smart-account.ts
//
// ARCHITECTURE: EIP-4337 UserOperations via permissionless.js + CDP Paymaster
//
// ✅ paymasterClient is created LAZILY inside getSmartAccountClient()
//    not at module level — so env variables are available when the function is called

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
    console.log("[LightAccount] Detected v1.1 vault:", addrV1);
    return { address: addrV1, factory: FACTORY_V1, version: "v1" };
  }
  if (v2Deployed) {
    console.log("[LightAccount] Detected v2.0 vault:", addrV2);
    return { address: addrV2, factory: FACTORY_V2, version: "v2" };
  }

  console.log("[LightAccount] No vault deployed yet, defaulting to v2:", addrV2);
  return { address: addrV2, factory: FACTORY_V2, version: "v2" };
};

// ── 3. Deploy vault (one-time regular tx) ────────────────────────────────────
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
export const getSmartAccountClient = async (walletClient: WalletClient) => {
  if (!walletClient.account) throw new Error("walletClient.account is null");

  // Read env INSIDE the function — not at module level
  // so that Next.js has already injected process.env when this is called
  const cdpApiKey = process.env.NEXT_PUBLIC_CDP_API_KEY;
  if (!cdpApiKey) throw new Error(
    "NEXT_PUBLIC_CDP_API_KEY is not set in .env\n" +
    "Expected value: your Coinbase Developer Platform API key (not the full URL)"
  );

  // Construct the full CDP URL from the API key
  const cdpUrl = `https://api.developer.coinbase.com/rpc/v1/base/${cdpApiKey}`;

  const ownerAddress = walletClient.account.address as Address;

  // Detect deployed vault version → select the correct EntryPoint
  const { address: vaultAddress, version: vaultVersion } =
    await detectVaultAddress(ownerAddress);

  // ✅ Guard: CDP Paymaster only supports EntryPoint v0.7 (vault v2)
  // Vault v1 uses EntryPoint v0.6 which CDP does not support → 404
  if (vaultVersion === "v1") {
    throw new Error(
      "CDP Paymaster only supports EntryPoint v0.7 (vault v2).\n" +
      "Your wallet has a v1 vault deployed which uses EntryPoint v0.6.\n" +
      "Gasless transactions via CDP are not available for v1 vaults."
    );
  }

  // Wrap JsonRpcAccount (MetaMask/wagmi) → LocalAccount
  // toLightSmartAccount requires an account type with signTransaction
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

  // Build LightAccount — always v2 at this point (v1 is blocked above)
  const lightAccount = await toLightSmartAccount({
    client:         publicClient,
    owner,
    version:        "2.0.0",
    factoryAddress: FACTORY_V2,
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
  });

  console.log("[EIP-4337] Vault:", vaultAddress);
  console.log("[EIP-4337] EntryPoint: v0.7");
  console.log("[EIP-4337] Paymaster: CDP (gasless)");

  // Create paymaster + bundler client lazily here
  const paymasterClient = createPaymasterClient({
    transport: http(cdpUrl),
  });

  // ✅ No estimateFeesPerGas override — let CDP estimate gas fees automatically
  const bundlerClient = createSmartAccountClient({
    account:          lightAccount,
    chain:            base,
    bundlerTransport: http(cdpUrl),
    paymaster:        paymasterClient,
  });

  return {
    account: { address: vaultAddress },

    sendUserOperation: async ({ calls }: { calls: VaultCall[] }) => {
      console.log(`[EIP-4337] Sending ${calls.length} call(s) via CDP Paymaster`);
      const hash = await bundlerClient.sendUserOperation({ calls });
      console.log("[EIP-4337] UserOp hash:", hash);
      return hash;
    },

    waitForUserOperationReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      console.log("[EIP-4337] Waiting for receipt:", hash);
      const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
      return { receipt };
    },

    deployVault: () => deployVault(walletClient),
    isDeployed:  () => isVaultDeployed(vaultAddress),
  };
};