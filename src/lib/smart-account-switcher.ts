// src/lib/smart-account-switcher.ts
import { type WalletClient } from "viem";
import { getSmartAccountClient } from "./smart-account";

/**
 * Unified entry point untuk semua komponen yang butuh smart account client.
 *
 * Otomatis deteksi:
 * - Native Smart Wallet (Farcaster Mini App, Base App, Coinbase Smart Wallet)
 *   → pakai wallet_sendCalls (EIP-5792), tidak butuh raw sign
 * - EOA biasa (Rabby, MetaMask)
 *   → bungkus jadi Coinbase Smart Account via Pimlico bundler
 */
export const getUnifiedSmartAccountClient = async (
  walletClient: WalletClient,
  connectorId: string | undefined,
  accountIndex: bigint = 0n
) => {
  console.log("[Switcher] Initializing Unified Smart Account Client...");
  return getSmartAccountClient(walletClient);
};