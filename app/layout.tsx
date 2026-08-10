import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Providers } from "./providers";
import { connection } from "next/server";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const bodoni = Bodoni_Moda({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://terminal.hedgents.com"),
  title: "Hedgents Metal Terminal",
  description:
    "Discover, compare, route, and trade eligible metal products across supported chains.",
  icons: {
    icon: [{ url: "/brand/hedgents-source-app-icon.png", type: "image/png" }],
  },
  openGraph: {
    title: "Hedgents Metal Terminal",
    description:
      "Discover, compare, and trade verified tokenized metal products on Solana.",
    images: [
      {
        url: "/brand/hedgents-source-app-icon.png",
        width: 330,
        height: 330,
        alt: "Hedgents Hg mark",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Hedgents Metal Terminal",
    description: "One execution interface for tokenized metal markets.",
    images: ["/brand/hedgents-source-app-icon.png"],
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0f110f",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${bodoni.variable}`}
    >
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
