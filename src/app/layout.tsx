import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "7Strike Terminal - Indian Options Trading",
  description: "Professional Indian options trading terminal with 7-Strike system, real-time OI tracking, and PCR analysis.",
  keywords: ["trading", "options", "NIFTY", "BANKNIFTY", "7-strike", "PCR", "OI analysis"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0a0e17] text-gray-200`}
      >
        {children}
      </body>
    </html>
  );
}
