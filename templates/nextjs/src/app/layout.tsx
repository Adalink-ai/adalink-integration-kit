import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TrackingProvider } from "@/components/tracking-provider";
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
  title: "Adaflow Starter",
  description: "App integrado à plataforma Adaflow — SSO, chat com IA e SDK prontos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TrackingProvider />
        {children}
      </body>
    </html>
  );
}
