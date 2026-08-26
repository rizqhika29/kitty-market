"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock3, Coins, XCircle } from "lucide-react";
import type { Market } from "@/lib/types";
import { formatClose, isExpired, splitPools, weiToInt } from "@/lib/types";
import { toGen } from "@/lib/gl";

function StatusChip({ market }: { market: Market }) {
  if (market.settled && market.outcome === "void") {
    return (
      <span className="status-chip bg-zinc-500/15 text-zinc-300">
        <AlertCircle className="h-4 w-4" /> Voided
      </span>
    );
  }
  if (market.settled) {
    return (
      <span
        className={
          market.outcome === "yes"
            ? "status-chip bg-emerald-500/15 text-emerald-300"
            : "status-chip bg-red-500/15 text-red-300"
        }
      >
        {market.outcome === "yes" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
        {market.outcome.toUpperCase()}
      </span>
    );
  }
  if (isExpired(market)) {
    return (
      <span className="status-chip bg-amber-500/15 text-amber-300">
        <Clock3 className="h-4 w-4" /> Awaiting AI
      </span>
    );
  }
  return (
    <span className="status-chip bg-punch-500/15 text-punch-300">
      <Clock3 className="h-4 w-4" /> Live
    </span>
  );
}

export function MarketCard({ market }: { market: Market }) {
  const { yesPct, total } = splitPools(market);

  return (
    <Link
      href={`/markets/${market.id}`}
      className="panel group flex flex-col gap-4 rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-brand-500/40 hover:shadow-glow"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="topic-tag">{market.topic}</span>
        <StatusChip market={market} />
      </div>

      <h3 className="line-clamp-2 font-display text-lg font-semibold leading-snug text-zinc-100 transition-colors group-hover:text-punch-300">
        {market.question}
      </h3>

      {/* Odds */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-zinc-400">
          <span className="font-semibold text-emerald-400">
            YES · {yesPct.toFixed(0)}%
          </span>
          <span className="font-semibold text-red-400">
            NO · {(100 - yesPct).toFixed(0)}%
          </span>
        </div>
        <div className="flex h-2.5 gap-px overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
            style={{ width: `${yesPct}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-red-400 to-rose-600 transition-all duration-500"
            style={{ width: `${100 - yesPct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-3 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <Coins className="h-3.5 w-3.5" />
          {toGen(market.pool)} GEN staked
        </span>
        <span>closes {formatClose(market.closes_at)}</span>
      </div>

      {(weiToInt(market.max_wager) > 0 || weiToInt(market.min_wager) > 0) && (
        <div className="-mt-2 text-[11px] text-brand-300/80">
          capped market ·{" "}
          {weiToInt(market.min_wager) > 0 ? `min ${toGen(market.min_wager)}` : "no min"}
          {" / "}
          {weiToInt(market.max_wager) > 0 ? `max ${toGen(market.max_wager)} GEN` : "no max"}
        </div>
      )}
    </Link>
  );
}
