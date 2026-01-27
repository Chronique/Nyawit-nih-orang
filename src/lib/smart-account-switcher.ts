import { type WalletClient } from "viem";
import { getCoinbaseSmartAccountClient } from "./coinbase-smart-account";
// import { getZeroDevSmartAccountClient } from "./zerodev-smart-account"; // ❌ Disable ZeroDev

export const getUnifiedSmartAccountClient = async (
  walletClient: WalletClient, 
  connectorId: string | undefined,
  accountIndex: bigint = 0n
) => {
  // 🟢 FORCED: Selalu gunakan Coinbase Smart Account
  // Ini akan memperbaiki masalah "Raw Sign" di Rabby dan menyamakan alamat Vault.
  console.log("🔀 Switcher: Force Coinbase Smart Wallet (System B) for consistency");
  return getCoinbaseSmartAccountClient(walletClient);
};