import { type WalletClient } from "viem";
import { getSmartAccountClient as getSimpleClient } from "./simple-smart-account";
import { getCoinbaseSmartAccountClient } from "./coinbase-smart-account";

/**
 * SMART WALLET SWITCHER
 * Otomatis memilih jenis Smart Account berdasarkan Wallet asli user.
 */
export const getUnifiedSmartAccountClient = async (
  walletClient: WalletClient, 
  connectorId?: string
) => {
  console.log("🔄 Switching Smart Account Logic for:", connectorId);

  // LOGIC DETEKSI
  // Jika user pakai Coinbase Wallet (biasanya id-nya 'coinbaseWalletSDK' atau 'coinbaseWallet')
  const isCoinbaseWallet = connectorId === "coinbaseWalletSDK" || connectorId === "coinbaseWallet";

  if (isCoinbaseWallet) {
    console.log("✅ Detected Coinbase Wallet -> Using Coinbase Smart Account");
    return await getCoinbaseSmartAccountClient(walletClient);
  } 
  
  // Default (MetaMask, Trust, Rainbow, dll) -> Pakai Simple Account (ERC-4337 standard)
  else {
    console.log("✅ Detected EOA (MetaMask/Other) -> Using Simple Smart Account");
    return await getSimpleClient(walletClient);
  }
};