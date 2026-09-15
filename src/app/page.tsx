"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import { PawPrint, Store, Rocket, Crown, Backpack } from "lucide-react";

export default function HomePage() {
  const { connected, connect, connecting, totalMarkets, totalTraders, totalWagers } =
    useSession();

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
      <div className="text-center max-w-2xl">
        <div className="flex items-center justify-center gap-3 mb-6">
          <PawPrint className="h-12 w-12 text-purple-400" />
          <h1 className="text-5xl font-bold text-white">Kitty Market</h1>
        </div>
        <p className="text-xl text-purple-300 font-medium mb-4">Curiosity Pays</p>
        <p className="text-lg text-white/60 mb-8">
          AI-resolved prediction markets on GenLayer. Open a market, take a side,
          let decentralized validators fetch the truth.
        </p>

        {!connected ? (
          <button
            onClick={connect}
            disabled={connecting}
            className="px-8 py-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-lg font-bold transition-all shadow-lg shadow-purple-600/25"
          >
            {connecting ? "Connecting…" : "Pounce In"}
          </button>
        ) : (
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/markets"
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition-all"
            >
              <Store className="h-5 w-5" /> Browse Markets
            </Link>
            <Link
              href="/markets/new"
              className="flex items-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-all border border-white/10"
            >
              <Rocket className="h-5 w-5" /> Launch Market
            </Link>
          </div>
        )}

        {connected && (
          <div className="grid grid-cols-3 gap-6 mt-12">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-2xl font-bold text-white">{totalMarkets}</p>
              <p className="text-sm text-white/50">Markets</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-2xl font-bold text-white">{totalTraders}</p>
              <p className="text-sm text-white/50">Traders</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-2xl font-bold text-white">{totalWagers}</p>
              <p className="text-sm text-white/50">GEN Wagered</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
