"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/session";
import { formatEther } from "viem";
import { Store, Clock, CircleCheck, CircleX, Skull, Loader2 } from "lucide-react";

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MarketsPage() {
  const { connected, getMarket, totalMarkets } = useSession();
  const [markets, setMarkets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const count = Number(totalMarkets);
      const loaded = [];
      for (let i = count - 1; i >= 0 && i >= count - 20; i--) {
        try {
          const m = await getMarket(String(i));
          loaded.push({ id: String(i), ...m });
        } catch {}
      }
      setMarkets(loaded);
      setLoading(false);
    }
    if (connected) load();
    else setLoading(false);
  }, [connected, totalMarkets, getMarket]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-12 w-12 text-purple-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Store className="h-6 w-6 text-purple-400" />
        <h1 className="text-2xl font-bold text-white">Markets</h1>
      </div>

      {markets.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-white/50 text-lg">No markets yet</p>
          <Link
            href="/markets/new"
            className="text-purple-400 hover:text-purple-300 mt-2 inline-block"
          >
            Launch the first one →
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {markets.map((m) => (
            <Link
              key={m.id}
              href={`/markets/${m.id}`}
              className="bg-white/5 backdrop-blur-lg rounded-xl p-5 border border-white/10 hover:border-purple-500/30 hover:bg-white/10 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <span className="text-xs font-medium text-purple-300 bg-purple-500/20 px-2 py-0.5 rounded-full">
                    {m.topic}
                  </span>
                  <h3 className="text-white font-semibold mt-2">{m.question}</h3>
                  <div className="flex items-center gap-4 mt-2 text-sm text-white/50">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(Number(m.closes_at))}
                    </span>
                    <span>
                      Pool: {parseFloat(formatEther(BigInt(m.pool || 0))).toFixed(2)} GEN
                    </span>
                  </div>
                </div>
                <div className="ml-4">
                  {m.settled ? (
                    m.outcome === "terminal_void" ? (
                      <span className="flex items-center gap-1 text-red-400 text-sm">
                        <Skull className="h-4 w-4" /> Terminal Void
                      </span>
                    ) : m.outcome === "void" ? (
                      <span className="flex items-center gap-1 text-yellow-400 text-sm">
                        <CircleX className="h-4 w-4" /> Void
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-green-400 text-sm">
                        <CircleCheck className="h-4 w-4" /> {m.outcome.toUpperCase()}
                      </span>
                    )
                  ) : (
                    <span className="text-white/40 text-sm">Open</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
