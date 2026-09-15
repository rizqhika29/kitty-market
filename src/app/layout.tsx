import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { Toaster } from "sonner";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Kitty Market — Curiosity Pays",
  description: "AI-resolved prediction markets on GenLayer",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <div className="fixed inset-0 -z-10 overflow-hidden">
            <div className="aurora-blob absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-purple-600/30 rounded-full" />
            <div className="aurora-blob absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-pink-600/20 rounded-full" style={{ animationDelay: "4s" }} />
          </div>
          <Navbar />
          <main className="min-h-screen pt-16">{children}</main>
          <Toaster theme="dark" position="bottom-right" />
        </SessionProvider>
      </body>
    </html>
  );
}
