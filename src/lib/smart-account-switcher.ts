import { type WalletClient } from "viem";
import { getSmartAccountClient as getSimpleClient } from "./simple-smart-account";
import { getCoinbaseSmartAccountClient } from "./coinbase-smart-account";

/**
 * SMART WALLET SWITCHER (ROBUST VERSION)
 * Otomatis memilih jenis Smart Account berdasarkan Wallet asli user.
 */
export const getUnifiedSmartAccountClient = async (
  walletClient: WalletClient, 
  connectorId?: string, // 👈 Jangan lupa koma disini
  accountIndex: bigint = 0n // 👈 Parameter baru (Default 0n)
) => {
  // 1. Log untuk Debugging
  console.log("🔍 [Switcher] Checking Wallet Type...");
  console.log("👉 Connector ID:", connectorId);
  console.log("👉 Salt/Index:", accountIndex);
  
  // 2. DETEKSI AGRESIF
  const isCoinbaseID = connectorId === "coinbaseWalletSDK" || connectorId === "coinbaseWallet";
  
  // @ts-ignore
  const isCoinbaseProvider = walletClient.transport?.provider?.isCoinbaseWallet === true;

  const isCoinbase = isCoinbaseID || isCoinbaseProvider;

  console.log("👉 Is Coinbase Detected?", isCoinbase);

  // 3. LOGIKA PEMILIHAN
  if (isCoinbase) {
    console.log("✅ MODE: Coinbase Smart Wallet (Sub-Account)");
    // Coinbase tidak butuh index (sudah permanen by default)
    return await getCoinbaseSmartAccountClient(walletClient);
  } 
  
  else {
    console.log("✅ MODE: Standard EOA (Simple Account)");
    // Default untuk MetaMask, TrustWallet, dll
    // Kita kirim index agar alamatnya bisa diatur (Permanen/Baru)
    return await getSimpleClient(walletClient, accountIndex);
  }
};