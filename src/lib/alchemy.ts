// src/lib/alchemy.ts
import { Network, Alchemy } from "alchemy-sdk";

const settings = {
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY, 
  network: Network.BASE_MAINNET,
};

export const alchemy = new Alchemy(settings);