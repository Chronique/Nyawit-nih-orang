import { type WalletClient } from "viem";
import { getSmartAccountClient } from "./smart-account";

export const getUnifiedSmartAccountClient = async (
  walletClient: WalletClient,
  connectorId: string | undefined,
  accountIndex: bigint = 0n
) => {
  console.log("Smart Account: Initializing Unified Vault via Coinbase Smart Account...");
  return getSmartAccountClient(walletClient);
};