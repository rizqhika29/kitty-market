"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import { Store, Rocket, Crown, Backpack, PawPrint } from "lucide-react";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/markets", label: "Markets", icon: Store },
  { href: "/markets/new", label: "Launch", icon: Rocket },
  { href: "/rankings", label: "Top Cats", icon: Crown },
  { href: "/portfolio", label: "Portfolio", icon: Backpack },
];

export function Navbar() {
  const pathname = usePathname();
  const { connected, connecting, address, alias, connect, disconnect } =
    useSession();

  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-white font-bold text-lg">
          <PawPrint className="h-6 w-6 text-purple-400" />
          <span>KittyMarket</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                pathname === href
                  ? "bg-purple-500/20 text-purple-300"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </div>

        <div>
          {connected ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/60 hidden sm:block">
                {alias || `${address?.slice(0, 6)}…${address?.slice(-4)}`}
              </span>
              <button
                onClick={disconnect}
                className="px-4 py-2 text-sm text-white/60 hover:text-white border border-white/10 rounded-lg hover:bg-white/5 transition-all"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all"
            >
              {connecting ? "Connecting…" : "Pounce In"}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
