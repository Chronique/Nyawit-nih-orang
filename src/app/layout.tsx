import type { Metadata, Viewport } from "next";
import "~/app/globals.css";

import { Providers } from "~/app/providers";
import { METADATA } from "~/lib/utils";

export const metadata: Metadata = {
  title: METADATA.name,
  openGraph: {
    title: METADATA.name,
    description: METADATA.description,
    images: [METADATA.bannerImageUrl],
    url: METADATA.homeUrl,
    siteName: METADATA.name
  },
  other: {
    // Talent Protocol domain verification
    "talentapp:project_verification": "838f50d79aa391386e0bec9c4f3c125d1714afd1128e4a4cf219d6816f683edbfcbdfb0154f667686f66015d08a16aaad18b73082ff764593f6c0873b89eef9c",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}