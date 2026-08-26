"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, PawPrint, Plus, SearchX } from "lucide-react";
import { marketContract, reader } from "@/lib/gl";
import { MarketCard } from "@/components/MarketCard";
import type { Market } from "@/lib/types";
import { TOPICS } from "@/lib/types";

function MarketsBrowser() {
  const params = useSearchParams();
  const topicParam = params.get("topic");

  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState(topicParam || "all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const contract = marketContract();
        if (!contract) {
          setLoading(false);
          return;
        }
        const client = reader();
        const totalRaw = await client.readContract({
          address: contract as `0x${string}`,
          functionName: "get_total_markets",
          args: [],
        });
        const total =
          typeof totalRaw === "bigint" ? Number(totalRaw) : parseInt(String(totalRaw));

        const rows: Market[] = [];
        for (let i = 0; i < total; i++) {
          try {
            const raw = await client.readContract({
              address: contract as `0x${string}`,
              functionName: "get_market",
              args: [String(i)],
            });
            if (typeof raw === "string") rows.push(JSON.parse(raw));
            else if (raw && typeof raw === "object") rows.push(raw as unknown as Market);
          } catch (e) {
            console.error(`[markets] failed to load #${i}:`, e);
          }
        }
        setMarkets(rows.reverse());
      } catch (e) {
        console.error("[markets] load failed:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visible = markets.filter((m) => {
    const q = query.toLowerCase();
    const matchQ =
      !q ||
      m.question.toLowerCase().includes(q) ||
      m.topic.toLowerCase().includes(q);
    return matchQ && (topic === "all" || m.topic === topic);
  });

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <Loader2 className="spin-slow h-9 w-9 text-brand-400" />
      </div>
    );
  }

  const chips = ["all", ...TOPICS];

  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      {/* Heading */}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="kicker">
            <PawPrint className="h-3.5 w-3.5" />
            The litter box
          </div>
          <h1 className="mt-4 font-display text-4xl font-bold text-white sm:text-5xl">
            {topic === "all" ? (
              <>
                All <span className="text-gradient">Markets</span>
              </>
            ) : (
              <span className="text-gradient capitalize">{topic}</span>
            )}
          </h1>
        </div>
        <Link href="/markets/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          New Market
        </Link>
      </div>

      {/* Filters */}
      <div className="mt-10 flex flex-col gap-5 lg:flex-row lg:items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hunt for a question…"
          className="input-field lg:max-w-sm"
        />
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => setTopic(c)}
              className={
                topic === c
                  ? "rounded-full bg-gradient-to-r from-brand-500 to-punch-500 px-4 py-2 text-sm font-semibold capitalize text-white shadow-glow"
                  : "rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium capitalize text-zinc-400 transition hover:border-brand-500/40 hover:text-white"
              }
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <div className="panel mt-12 rounded-[2rem] p-16 text-center">
          <SearchX className="mx-auto mb-4 h-12 w-12 text-brand-300" />
          <h2 className="font-display text-xl font-bold text-white">
            Nothing here yet
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-zinc-400">
            {markets.length === 0
              ? "Be the first cat to open a market on Kitty."
              : "No market matches your filters — loosen them up."}
          </p>
          {markets.length === 0 && (
            <Link href="/markets/new" className="btn-primary mt-7 inline-flex">
              <Plus className="h-4 w-4" />
              Open the First Market
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MarketsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[55vh] items-center justify-center">
          <Loader2 className="spin-slow h-9 w-9 text-brand-400" />
        </div>
      }
    >
      <MarketsBrowser />
    </Suspense>
  );
}
