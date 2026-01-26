import { type WalletClient } from "viem";
import { getCoinbaseSmartAccountClient } from "./coinbase-smart-account";
import { getZeroDevSmartAccountClient } from "./zerodev-smart-account"; // 👈 Import baru

export const getUnifiedSmartAccountClient = async (
  walletClient: WalletClient, 
  connectorId: string | undefined,
  accountIndex: bigint = 0n
) => {
  // 🟢 EKSPERIMEN: PAKSA PAKE ZERODEV DULU
  // Kita bypass logika deteksi wallet, kita langsung tes ZeroDev.
  console.log("🔀 Switcher: Using ZeroDev Kernel Experiment");
  return getZeroDevSmartAccountClient(walletClient);

  /* Logika lama di-disable dulu biar fokus tes ZeroDev
  const isCoinbase = connectorId === 'coinbaseWalletSDK' || connectorId === 'coinbaseWallet';
  if (isCoinbase) {
    return getCoinbaseSmartAccountClient(walletClient);
  }
  // Default ke SimpleAccount (Bisa diganti nanti)
  // ...
  */
};