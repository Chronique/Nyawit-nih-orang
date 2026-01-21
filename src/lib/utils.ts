import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export const METADATA = {
  name: "Nyawit Nih Orang",
  description: "Earn Eth or Usdc from dust token",
  bannerImageUrl: 'https://nyawit-nih-orang.vercel.app/banner.png',
  iconImageUrl: 'https://nyawit-nih-orang.vercel.app/icon.png',
  // homeUrl: process.env.NEXT_PUBLIC_URL ?? "https://frames-v2-demo-lilac.vercel.app",
  homeUrl: "https://nyawit-nih-orang.vercel.app",
  splashBackgroundColor: "#FFFFFF"
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
