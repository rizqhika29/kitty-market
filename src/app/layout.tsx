import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { SessionProvider } from "@/lib/session";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Kitty Market — Curiosity Pays",
  description:
    "AI-resolved prediction markets on GenLayer. Open a market, take a side, let decentralized validators fetch the truth.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body min-h-screen">
        {/* Backdrop */}
        <div className="backdrop-aurora">
          <span className="blob-a" />
          <span className="blob-b" />
          <span className="blob-c" />
        </div>
        <div className="backdrop-dots" />

        <SessionProvider>
          <Toaster
            position="top-center"
            toastOptions={{ style: { zIndex: 9999 } }}
          />
          <Navbar />
          <main className="relative z-10">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
