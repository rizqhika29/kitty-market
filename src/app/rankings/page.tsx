"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { Crown, Fish, Loader2 } from "lucide-react";

export default function RankingsPage() {
  const { connected, getTopCats } = useSession();
  const [cats, setCats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await getTopCats();
        setCats(data);
      } catch {}
      setLoading(false);
    }
    if (connected) load();
    else setLoading(false);
  }, [connected, getTopCats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-12 w-12 text-purple-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Crown className="h-6 w-6 text-yellow-400" />
        <h1 className="text-2xl font-bold text-white">Top Cats</h1>
      </div>

      {cats.length === 0 ? (
        <div className="text-center py-20">
          <Fish className="h-16 w-16 text-white/20 mx-auto mb-4" />
          <p className="text-white/50 text-lg">No rankings yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cats.map((cat, i) => (
            <div
              key={cat.address}
              className="bg-white/5 backdrop-blur-lg rounded-xl p-4 border border-white/10 flex items-center gap-4"
            >
              <div className="text-2xl font-bold text-white/30 w-8 text-center">
                {i + 1}
              </div>
              <div className="flex-1">
                <p className="text-white font-semibold">{cat.name}</p>
                <p className="text-xs text-white/40 font-mono">
                  {cat.address.slice(0, 6)}…{cat.address.slice(-4)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-green-400 font-bold">
                  {parseFloat(cat.earnings).toFixed(2)} GEN
                </p>
                <p className="text-xs text-white/40">{cat.hit_rate}% hit rate</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
