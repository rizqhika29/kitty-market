"use client";

import { useEffect, useState } from "react";
import { Crown, Fish, Loader2, Medal } from "lucide-react";
import { marketContract, reader, toGen } from "@/lib/gl";

interface Row {
  name: string;
  earnings: string;
  hit_rate: string;
  address: string;
}

const rankStyles = [
  "from-amber-300 to-yellow-500 text-white",
  "from-zinc-200 to-zinc-400 text-zinc-900",
  "from-orange-400 to-amber-700 text-white",
];

export default function RankingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const contract = marketContract();
        if (!contract) return;
        const raw = await reader().readContract({
          address: contract as `0x${string}`,
          functionName: "get_top_cats",
          args: [],
        });

        let parsed: unknown = raw;
        if (typeof raw === "string") parsed = JSON.parse(raw);
        else {
          try {
            parsed = JSON.parse(JSON.stringify(raw));
          } catch {
            /* keep as-is */
          }
        }
        if (Array.isArray(parsed)) setRows(parsed);
      } catch (e) {
        console.error("[rankings] failed:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <Loader2 className="spin-slow h-9 w-9 text-brand-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      {/* Heading */}
      <div className="text-center">
        <div className="kicker">Hall of whiskers</div>
        <h1 className="mt-5 font-display text-4xl font-bold sm:text-6xl">
          <span className="text-gradient">Top Cats</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-zinc-400">
          Ranked by lifetime earnings. Accuracy is the vanity metric — payouts
          don&apos;t lie.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="panel mt-14 rounded-[2rem] p-16 text-center">
          <Fish className="mx-auto mb-4 h-12 w-12 text-brand-300" />
          <h2 className="font-display text-xl font-bold text-white">
            The board is empty
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-zinc-400">
            No one has collected a payout yet. First winner takes the crown 👑
          </p>
        </div>
      ) : (
        <ol className="mt-14 space-y-3">
          {rows.map((r, i) => (
            <li
              key={r.address + i}
              className={
                i === 0
                  ? "panel relative overflow-hidden rounded-3xl border border-amber-400/30 p-6"
                  : "panel rounded-3xl p-5"
              }
            >
              {i === 0 && (
                <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br from-amber-400/20 to-transparent blur-2xl" />
              )}
              <div className="flex items-center gap-5">
                {/* Rank badge */}
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl font-display font-bold ${
                    i < 3
                      ? `bg-gradient-to-br ${rankStyles[i]} shadow-glow`
                      : "border border-white/10 bg-white/[0.04] text-zinc-400"
                  }`}
                >
                  {i === 0 ? <Crown className="h-6 w-6" /> : i < 3 ? <Medal className="h-6 w-6" /> : i + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className={`truncate font-semibold ${i === 0 ? "text-lg text-amber-200" : "text-white"}`}>
                    {r.name}
                  </p>
                  <p className="font-mono text-xs text-zinc-500">{r.address}</p>
                </div>

                <div className="text-right">
                  <p className={`font-display font-bold ${i === 0 ? "text-xl text-amber-300" : "text-brand-300"}`}>
                    {toGen(r.earnings)} GEN
                  </p>
                  <p className="text-xs text-zinc-500">{parseInt(r.hit_rate)}% calls right</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
