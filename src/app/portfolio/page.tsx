"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { formatEther } from "viem";
import { Backpack, Coins, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function PortfolioPage() {
  const {
    connected,
    address,
    alias,
    balance,
    ownerAddress,
    feeBalance,
    getTraderInfo,
    getTraderPositions,
    getMarket,
    cashOut,
    collectFees,
  } = useSession();

  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cashOutAmount, setCashOutAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isOwner =
    address && ownerAddress && address.toLowerCase() === ownerAddress.toLowerCase();

  useEffect(() => {
    async function load() {
      if (!address) return;
      try {
        const pos = await getTraderPositions(address);
        const enriched = [];
        for (const p of pos) {
          try {
            const m = await getMarket(p.market_id);
            enriched.push({ ...p, market: m });
          } catch {
            enriched.push(p);
          }
        }
        setPositions(enriched);
      } catch {}
      setLoading(false);
    }
    load();
  }, [address, getTraderPositions, getMarket]);

  const handleCashOut = async () => {
    if (!cashOutAmount || parseFloat(cashOutAmount) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSubmitting(true);
    try {
      await cashOut(cashOutAmount);
      toast.success("Cashed out!");
      setCashOutAmount("");
    } catch (e: any) {
      toast.error(e?.message || "Cash out failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCollectFees = async () => {
    setSubmitting(true);
    try {
      await collectFees(feeBalance);
      toast.success("Fees collected!");
    } catch (e: any) {
      toast.error(e?.message || "Collect fees failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-white/50 text-lg">Connect your wallet first</p>
      </div>
    );
  }

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
        <Backpack className="h-6 w-6 text-purple-400" />
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
      </div>

      {/* Profile */}
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-500/20 rounded-full flex items-center justify-center">
            <Coins className="h-6 w-6 text-purple-400" />
          </div>
          <div>
            <p className="text-white font-semibold">{alias || "Anonymous"}</p>
            <p className="text-xs text-white/40 font-mono">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <p className="text-sm text-white/50">Balance</p>
            <p className="text-xl font-bold text-white">{balance} GEN</p>
          </div>
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <p className="text-sm text-white/50">Open Positions</p>
            <p className="text-xl font-bold text-white">
              {positions.filter((p) => !p.closed).length}
            </p>
          </div>
        </div>

        {/* Cash out */}
        <div className="mt-4 flex gap-2">
          <input
            type="number"
            placeholder="Amount (GEN)"
            value={cashOutAmount}
            onChange={(e) => setCashOutAmount(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500"
            min="0"
            step="0.01"
          />
          <button
            onClick={handleCashOut}
            disabled={submitting || !cashOutAmount}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all"
          >
            Cash Out
          </button>
        </div>
      </div>

      {/* Admin panel */}
      {isOwner && (
        <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-yellow-500/20 mb-6">
          <h3 className="text-yellow-400 font-semibold mb-3">Admin Panel</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/50">Fee Balance</p>
              <p className="text-lg font-bold text-white">{feeBalance} GEN</p>
            </div>
            <button
              onClick={handleCollectFees}
              disabled={submitting || parseFloat(feeBalance) <= 0}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white rounded-lg font-bold transition-all"
            >
              Collect Fees
            </button>
          </div>
        </div>
      )}

      {/* Positions */}
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10">
        <h3 className="text-white font-semibold mb-4">Positions</h3>
        {positions.length === 0 ? (
          <p className="text-white/40 text-sm">No positions yet</p>
        ) : (
          <div className="space-y-3">
            {positions.map((p, i) => (
              <div
                key={i}
                className="bg-white/5 rounded-xl p-4 border border-white/10"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm">
                      Market #{p.market_id} — {p.side.toUpperCase()}
                    </p>
                    {p.market && (
                      <p className="text-xs text-white/40 mt-1">
                        {p.market.question}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-white font-bold">
                      {parseFloat(formatEther(BigInt(p.size))).toFixed(4)} GEN
                    </p>
                    <p
                      className={`text-xs ${
                        p.closed ? "text-white/30" : "text-green-400"
                      }`}
                    >
                      {p.closed ? "Closed" : "Open"}
                    </p>
                  </div>
                </div>
                {p.market && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-white/30">
                    {p.market.settled && (
                      <span>
                        Outcome: {p.market.outcome?.toUpperCase()}
                      </span>
                    )}
                    <a
                      href={`/markets/${p.market_id}`}
                      className="text-purple-400 hover:text-purple-300 flex items-center gap-1"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
