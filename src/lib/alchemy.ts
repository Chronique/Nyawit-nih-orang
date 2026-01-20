import { Network, Alchemy } from "alchemy-sdk";

const apiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

// TAMBAHAN: Log ini akan muncul di Console Browser (F12) nanti
// Kita cek apakah key-nya terbaca atau undefined
console.log("DEBUG ALCHEMY KEY:", apiKey ? "Key Found (" + apiKey.slice(0,5) + "...)" : "KEY UNDEFINED / MISSING");

const settings = {
  apiKey: apiKey, // Jika ini undefined, SDK otomatis pakai 'demo'
  network: Network.BASE_MAINNET,
};

export const alchemy = new Alchemy(settings);