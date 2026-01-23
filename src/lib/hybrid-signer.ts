import { type WalletClient, type Hex } from "viem";
import { toAccount } from "viem/accounts";

/**
 * HYBRID SIGNER (FIXED)
 * Tugas: Mengubah WalletClient (MetaMask/EOA) menjadi 'LocalAccount' yang valid.
 */
export const getHybridSigner = (walletClient: WalletClient) => {
  if (!walletClient.account) {
    throw new Error("Hybrid Signer Error: Wallet tidak terdeteksi (No Account)");
  }

  const address = walletClient.account.address;

  // Kita gunakan toAccount dari Viem untuk membuat custom wrapper
  return toAccount({
    address: address,

    // 🔥🔥🔥 BAGIAN PENTING YANG HILANG DI FILE ANDA 🔥🔥🔥
    type: "local",    
    source: "custom", 
    // 👆👆👆 WAJIB ADA. Tanpa ini, akan selalu error "Raw Sign".

    // 1. SIGN MESSAGE (Wajib untuk UserOp)
    async signMessage({ message }) {
      return walletClient.signMessage({ 
        message, 
        account: address 
      });
    },

    // 2. SIGN TYPED DATA (Wajib untuk protokol tertentu)
    async signTypedData(typedData) {
      return walletClient.signTypedData({ 
        ...typedData, 
        account: address 
      } as any);
    },

    // 3. SIGN TRANSACTION (DUMMY / BYPASS)
    // Fungsi ini wajib ada agar Viem tidak komplain saat validasi akun.
    async signTransaction(transaction) {
      // Return signature kosong yang valid secara format hex
      return "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as Hex;
    },
  });
};