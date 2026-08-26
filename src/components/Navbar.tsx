"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import {
  PawPrint,
  Store,
  Rocket,
  Crown,
  Backpack,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { short } from "@/lib/gl";

const links = [
  { href: "/markets", label: "Markets", icon: Store },
  { href: "/markets/new", label: "Launch", icon: Rocket },
  { href: "/rankings", label: "Top Cats", icon: Crown },
  { href: "/portfolio", label: "Portfolio", icon: Backpack },
];

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { account, profile, connect, disconnect } = useSession();

  const active = (href: string) =>
    href === "/markets"
      ? pathname.startsWith("/markets") && pathname !== "/markets/new"
      : pathname.startsWith(href);

  return (
    <header className="sticky top-4 z-40 px-4">
      <div className="mx-auto max-w-6xl">
        <div className="nav-shell flex h-16 items-center justify-between gap-3 px-4 sm:px-5">
          {/* Brand */}
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            <span className="brand-badge">
              <PawPrint className="h-5 w-5 text-white" />
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-white">
              Kitty<span className="text-gradient">Market</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "relative flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  active(href)
                    ? "bg-brand-500/15 text-white"
                    : "text-zinc-400 hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>

          {/* Session */}
          <div className="flex items-center gap-2">
            {account ? (
              <>
                <div className="hidden rounded-full border border-white/10 bg-white/5 py-2 pl-3 pr-2 sm:flex sm:items-center sm:gap-2">
                  <span className="max-w-[120px] truncate text-sm font-medium text-punch-300">
                    {profile?.name ?? short(account)}
                  </span>
                  <span className="font-mono text-xs text-zinc-500">
                    {short(account)}
                  </span>
                </div>
                <button
                  onClick={disconnect}
                  title="Disconnect wallet"
                  className="rounded-full p-2.5 text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button onClick={() => void connect()} className="btn-primary !px-5 !py-2 text-sm">
                Pounce In
              </button>
            )}

            {/* Mobile toggle */}
            <button
              className="rounded-xl p-2.5 text-zinc-400 transition hover:bg-white/5 hover:text-white md:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {open && (
          <nav className="nav-shell mt-2 animate-rise space-y-1 p-3 md:hidden">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={clsx(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium",
                  active(href)
                    ? "bg-brand-500/15 text-white"
                    : "text-zinc-400 hover:bg-white/5 hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
