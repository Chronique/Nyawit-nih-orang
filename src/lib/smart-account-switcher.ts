import { type WalletClient } from "viem";
import { getCoinbaseSmartAccountClient } from "./coinbase-smart-account";
import { getZeroDevSmartAccountClient } from "./zerodev-smart-account"; 

export const getUnifiedSmartAccountClient = async (
  walletClient: WalletClient, 
  connectorId: string | undefined,
  accountIndex: bigint = 0n
) => {
  // 1. Deteksi apakah ini Coinbase Wallet (System B)
  // ID 'coinbaseWalletSDK' biasanya dipakai oleh connector wagmi v5
  const isCoinbaseSmartWallet = connectorId === 'coinbaseWalletSDK' || connectorId === 'coinbaseWallet';

  if (isCoinbaseSmartWallet) {
    console.log("🔀 Switcher: Detected Coinbase Smart Wallet (System B)");
    return getCoinbaseSmartAccountClient(walletClient);
  } 
  
  // 2. Jika bukan Coinbase (misal: Metamask, Rabby, Rainbow) -> Anggap EOA
  // Kita bungkus EOA ini dengan ZeroDev Kernel (System A)
  else {
    console.log("🔀 Switcher: Detected EOA/External Wallet (System A - ZeroDev)");
    return getZeroDevSmartAccountClient(walletClient);
  }
};