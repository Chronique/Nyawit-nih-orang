import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export const METADATA = {
  name: "Nyawit Nih Orang",
  description: "Earn Eth or Usdc from dust token",
  bannerImageUrl: 'https://i.imgur.com/2bsV8mV.png',
  iconImageUrl: 'https://i.imgur.com/brcnijg.png',
  // homeUrl: process.env.NEXT_PUBLIC_URL ?? "https://frames-v2-demo-lilac.vercel.app",
  homeUrl: "https://dust-sweeper-theta.vercel.app",
  splashBackgroundColor: "#FFFFFF"
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
