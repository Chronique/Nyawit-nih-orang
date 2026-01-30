import type { Metadata, Viewport } from "next";
import "~/app/globals.css";
import "@worldcoin/mini-apps-ui-kit-react/styles.css";
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
};

// [BARU]: Konfigurasi Viewport untuk mematikan Zoom
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
    // Tambahkan suppressHydrationWarning di sini
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Hardcoded meta tag untuk verifikasi Base Build */}
        <meta name="base:app_id" content="6970aac385045b1333e7bae2" />
        <meta property="base:app_id" content="6970aac385045b1333e7bae2" />
        </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}