import type { Metadata } from "next";

import { Toaster } from "@/components/ui/sonner";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "OpenClaw Mission Control",
  description: "A production-grade control surface for live OpenClaw workspaces, agents, models, and runtimes."
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
