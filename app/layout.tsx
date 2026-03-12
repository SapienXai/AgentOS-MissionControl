import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/sonner";

import "@/app/globals.css";

const siteTitle = "AgentOS | OpenClaw Mission Control";
const siteDescription = "Human Control Layer for AI Agents and Companies | Built on OpenClaw.";
const socialImagePath = "/readme/agentos1.webp";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL;
const metadataBase = new URL(siteUrl ? (siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`) : "http://localhost:3000");

export const viewport: Viewport = {
  themeColor: "#09101c"
};

export const metadata: Metadata = {
  metadataBase,
  title: siteTitle,
  description: siteDescription,
  applicationName: "AgentOS | Mission Control",
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    siteName: "AgentOS | Mission Control",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: socialImagePath,
        width: 1536,
        height: 1024,
        alt: "AgentOS mission-control interface"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [socialImagePath]
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        {children}
        <Toaster theme="dark" richColors closeButton />
      </body>
    </html>
  );
}
