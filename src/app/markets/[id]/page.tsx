"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "@/lib/session";
import { formatEther } from "viem";
import {
  ArrowLeft,
  Brain,
  CircleCheck,
  CircleX,
  Coins,
  Swords,
  Clock,
  Shield,
  AlertTriangle,
  RotateCcw,
  Skull,
} from "lucide-react";
import { toast } from "sonner";

function truncateAddress(addr: string, start = 6, end = 4) {
  return `${addr.slice(0, start)}…${addr.slice(-end)}`;
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MarketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const {
    address,
    connected,
    takeSide,
    settleMarket,
    terminalVoid,
    claimPayout,
    reclaimStake,
    getMarket,
  } = useSession();

  const [market, setMarket] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);

  const fetchMarket = useCallback(async () => {
    try {
      const m = await getMarket(id);
      setMarket(m);
    } catch (e) {
      console.error("Failed to fetch market", e);
    } finally {
      setLoading(false);
    }
  }, [id, getMarket, address]);

  useEffect(() => {
    fetchMarket();
  }, [fetchMarket]);

  useEffect(() => {
    if (polling) {
      const interval = setInterval(async () => {
        try {
          const m = await getMarket(id);
          setMarket(m);
          if (m.settled) {
            setPolling(false);
            clearInterval(interval);
            toast.success("Market settled!");
          }
        } catch {}
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [polling, id, getMarket]);

  const handleTakeSide = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSubmitting(true);
    try {
      await takeSide(id, side, amount);
      toast.success(`Bet ${amount} GEN on ${side.toUpperCase()}`);
      setAmount("");
      await fetchMarket();
    } catch (e: any) {
      toast.error(e?.message || "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSettle = async () => {
    setSubmitting(true);
    try {
      await settleMarket(id);
      setPolling(true);
      toast.info("Settlement triggered – validators are checking evidence…");
    } catch (e: any) {
      toast.error(e?.message || "Settlement failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTerminalVoid = async () => {
    setSubmitting(true);
    try {
      await terminalVoid(id);
      toast.success("Terminal void triggered – all stakes refundable");
      await fetchMarket();
    } catch (e: any) {
      toast.error(e?.message || "Terminal void failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaim = async () => {
    setSubmitting(true);
    try {
      await claimPayout(id);
      toast.success("Payout claimed!");
      await fetchMarket();
    } catch (e: any) {
      toast.error(e?.message || "Claim failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReclaim = async () => {
    setSubmitting(true);
    try {
      await reclaimStake(id);
      toast.success("Full stake returned!");
      await fetchMarket();
    } catch (e: any) {
      toast.error(e?.message || "Reclaim failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <CircleX className="h-16 w-16 text-red-400" />
        <p className="text-white/60 text-lg">Market not found</p>
        <button
          onClick={() => router.push("/markets")}
          className="text-purple-400 hover:text-purple-300 flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back to markets
        </button>
      </div>
    );
  }

  const isHost =
    address && market.host?.toLowerCase() === address.toLowerCase();
  const isOpen =
    !market.settled && !market.terminal_void && Date.now() / 1000 < Number(market.closes_at);
  const isSettled = market.settled;
  const isTerminalVoid = market.terminal_void || market.outcome === "terminal_void";
  const isVoid = market.outcome === "void" || isTerminalVoid;
  const settleAttempts = Number(market.settle_attempts || 0);
  const MAX_ATTEMPTS = 5;
  const canTerminalVoid =
    !isSettled && !isTerminalVoid && settleAttempts >= MAX_ATTEMPTS;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <button
        onClick={() => router.push("/markets")}
        className="text-purple-400 hover:text-purple-300 flex items-center gap-2 mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back to markets
      </button>

      {/* Header */}
      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <span className="text-xs font-medium text-purple-300 bg-purple-500/20 px-2 py-1 rounded-full">
              {market.topic}
            </span>
            <h1 className="text-2xl font-bold text-white mt-3">
              {market.question}
            </h1>
          </div>
          {isSettled && (
            <div
              className={`px-3 py-1 rounded-full text-sm font-bold ${
                isTerminalVoid
                  ? "bg-red-500/20 text-red-300 border border-red-500/30"
                  : isVoid
                  ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
                  : "bg-green-500/20 text-green-300 border border-green-500/30"
              }`}
            >
              {isTerminalVoid
                ? "TERMINAL VOID"
                : isVoid
                ? "VOID"
                : market.outcome?.toUpperCase()}
            </div>
          )}
        </div>

        {/* Evidence */}
        <div className="flex items-center gap-2 text-sm text-white/50 mb-2">
          <Shield className="h-4 w-4" />
          <span>Evidence:</span>
          <a
            href={market.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-300 hover:underline"
          >
            {new URL(market.source_url).hostname}
          </a>
        </div>

        {/* Host */}
        <div className="flex items-center gap-2 text-sm text-white/50">
          <span>Host:</span>
          <span className="font-mono text-white/70">
            {truncateAddress(market.host)}
          </span>
          {isHost && (
            <span className="text-xs text-yellow-400">(you)</span>
          )}
        </div>

        {/* Close date */}
        <div className="flex items-center gap-2 text-sm text-white/50 mt-2">
          <Clock className="h-4 w-4" />
          <span>Closes: {formatDate(Number(market.closes_at))}</span>
        </div>

        {/* Terminal void info */}
        {settleAttempts > 0 && !isSettled && (
          <div className="mt-4 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-orange-300 text-sm">
              <AlertTriangle className="h-4 w-4" />
              <span>
                Settlement attempts: {settleAttempts}/{MAX_ATTEMPTS}
              </span>
            </div>
            <p className="text-orange-200/60 text-xs mt-1">
              If evidence remains inaccessible after {MAX_ATTEMPTS} attempts,
              anyone can trigger a terminal void for full refunds.
            </p>
          </div>
        )}

        {/* Terminal void banner */}
        {isTerminalVoid && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-red-300 font-bold mb-2">
              <Skull className="h-5 w-5" />
              <span>Terminal Void – Evidence Permanently Inaccessible</span>
            </div>
            <p className="text-red-200/70 text-sm">
              {market.verdict_note ||
                "Settlement failed after maximum attempts. All stakes are fully refundable."}
            </p>
          </div>
        )}
      </div>

      {/* Pools */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
          <p className="text-green-300 text-sm font-medium">YES Pool</p>
          <p className="text-white text-xl font-bold mt-1">
            {parseFloat(formatEther(BigInt(market.yes_pool || 0))).toFixed(2)}
          </p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <p className="text-white/60 text-sm font-medium">Total Pool</p>
          <p className="text-white text-xl font-bold mt-1">
            {parseFloat(formatEther(BigInt(market.pool || 0))).toFixed(2)}
          </p>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
          <p className="text-red-300 text-sm font-medium">NO Pool</p>
          <p className="text-white text-xl font-bold mt-1">
            {parseFloat(formatEther(BigInt(market.no_pool || 0))).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Verdict */}
      {isSettled && market.verdict_note && (
        <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-5 w-5 text-purple-400" />
            <h3 className="text-white font-semibold">Why the AI decided this</h3>
          </div>
          <p className="text-white/70 text-sm leading-relaxed">
            {market.verdict_note}
          </p>
        </div>
      )}

      {/* Actions */}
      {connected && (
        <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10">
          {/* Place bet */}
          {isOpen && !isHost && (
            <div>
              <h3 className="text-white font-semibold mb-4">Place a Bet</h3>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setSide("yes")}
                  className={`flex-1 py-3 rounded-xl font-bold transition-all ${
                    side === "yes"
                      ? "bg-green-500 text-white shadow-lg shadow-green-500/25"
                      : "bg-white/5 text-white/50 hover:bg-white/10"
                  }`}
                >
                  YES
                </button>
                <button
                  onClick={() => setSide("no")}
                  className={`flex-1 py-3 rounded-xl font-bold transition-all ${
                    side === "no"
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/25"
                      : "bg-white/5 text-white/50 hover:bg-white/10"
                  }`}
                >
                  NO
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Amount (GEN)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500"
                  min="0"
                  step="0.01"
                />
                <button
                  onClick={handleTakeSide}
                  disabled={submitting || !amount}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all"
                >
                  {submitting ? "Betting…" : "Bet"}
                </button>
              </div>
              {isHost && (
                <p className="text-yellow-400 text-xs mt-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Since you control the evidence URL, the contract locks you
                  out of taking a side here.
                </p>
              )}
            </div>
          )}

          {/* Settle */}
          {isOpen && !isHost && (
            <button
              onClick={handleSettle}
              disabled={submitting}
              className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
            >
              <Brain className="h-5 w-5" />
              {submitting ? "Settling…" : "Trigger AI Settlement"}
            </button>
          )}

          {/* Terminal void button */}
          {canTerminalVoid && (
            <button
              onClick={handleTerminalVoid}
              disabled={submitting}
              className="w-full mt-4 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
            >
              <Skull className="h-5 w-5" />
              {submitting
                ? "Triggering…"
                : `Trigger Terminal Void (${settleAttempts}/${MAX_ATTEMPTS} attempts)`}
            </button>
          )}

          {/* Claim payout */}
          {isSettled && !isVoid && (
            <button
              onClick={handleClaim}
              disabled={submitting}
              className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
            >
              <Coins className="h-5 w-5" />
              {submitting ? "Claiming…" : "Claim Payout"}
            </button>
          )}

          {/* Reclaim stake */}
          {isSettled && isVoid && (
            <div>
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg mb-4">
                <p className="text-yellow-300 text-sm">
                  {isTerminalVoid
                    ? "Evidence was permanently inaccessible. All stakes are fully refundable."
                    : "Verdict was inconclusive — all stakes are reclaimable."}
                </p>
              </div>
              <button
                onClick={handleReclaim}
                disabled={submitting}
                className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
              >
                <RotateCcw className="h-5 w-5" />
                {submitting ? "Reclaiming…" : "Reclaim Full Stake"}
              </button>
            </div>
          )}

          {/* Waiting for settlement */}
          {polling && (
            <div className="mt-4 flex items-center justify-center gap-2 text-purple-300">
              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-purple-400" />
              <span className="text-sm">
                Validators are fetching the evidence…
              </span>
            </div>
          )}
        </div>
      )}

      {!connected && (
        <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10 text-center">
          <p className="text-white/50">Connect your wallet to interact</p>
        </div>
      )}
    </div>
  );
}
