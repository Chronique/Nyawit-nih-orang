import { type WalletClient } from "viem";
import { getCoinbaseSmartAccountClient } from "./coinbase-smart-account";
// import { getZeroDevSmartAccountClient } from "./zerodev-smart-account"; // Disable dulu

export const getUnifiedSmartAccountClient = async (
  walletClient: WalletClient, 
  connectorId: string | undefined,
  accountIndex: bigint = 0n
) => {
  // 🟢 TEMPORARY OVERRIDE:
  // Semua wallet (Farcaster, Rabby, Metamask) dipaksa pakai Coinbase Smart Wallet Factory.
  // Ini agar alamat Vault konsisten dan menghindari isu raw sign di ZeroDev.
  
  console.log("🔀 Switcher: Forcing Coinbase Smart Wallet for all connectors (Temporary)");
  return getCoinbaseSmartAccountClient(walletClient);

  /* LOGIKA LAMA (Disimpan untuk nanti)
  const isCoinbaseSmartWallet = connectorId === 'coinbaseWalletSDK' || connectorId === 'coinbaseWallet';
  if (isCoinbaseSmartWallet) {
    return getCoinbaseSmartAccountClient(walletClient);
  } else {
    return getZeroDevSmartAccountClient(walletClient);
  }
  */
};