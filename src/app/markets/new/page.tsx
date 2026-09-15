"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Rocket, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const TOPICS = [
  "crypto",
  "sports",
  "politics",
  "entertainment",
  "tech",
  "science",
  "other",
];

export default function NewMarketPage() {
  const router = useRouter();
  const { connected, join, alias, openMarket } = useSession();
  const [question, setQuestion] = useState("");
  const [topic, setTopic] = useState("crypto");
  const [sourceUrl, setSourceUrl] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [minWager, setMinWager] = useState("");
  const [maxWager, setMaxWager] = useState("");
  const [joinAlias, setJoinAlias] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [needsJoin, setNeedsJoin] = useState(false);

  const handleSubmit = async () => {
    if (!question.trim()) {
      toast.error("Question is required");
      return;
    }
    if (question.length > 200) {
      toast.error("Question must be 200 chars or less");
      return;
    }
    if (!sourceUrl.trim()) {
      toast.error("Evidence URL is required");
      return;
    }
    if (!closeDate) {
      toast.error("Close date is required");
      return;
    }

    const closesAt = Math.floor(new Date(closeDate).getTime() / 1000);
    if (closesAt <= Date.now() / 1000) {
      toast.error("Close date must be in the future");
      return;
    }
    if (closesAt > Date.now() / 1000 + 365 * 24 * 3600) {
      toast.error("Close date too far in future");
      return;
    }

    if (minWager && maxWager && parseFloat(minWager) > parseFloat(maxWager)) {
      toast.error("Min wager cannot exceed max wager");
      return;
    }

    setSubmitting(true);
    try {
      await openMarket({
        question: question.trim(),
        topic,
        sourceUrl: sourceUrl.trim(),
        closesAt,
        minWager: minWager || "0",
        maxWager: maxWager || "0",
      });
      toast.success("Market launched!");
      router.push("/markets");
    } catch (e: any) {
      if (e?.message?.includes("unknown trader") || e?.message?.includes("not joined")) {
        setNeedsJoin(true);
      } else {
        toast.error(e?.message || "Failed to create market");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoin = async () => {
    if (!joinAlias.trim()) {
      toast.error("Alias is required");
      return;
    }
    setSubmitting(true);
    try {
      await join(joinAlias.trim());
      toast.success("Joined the pride!");
      setNeedsJoin(false);
    } catch (e: any) {
      toast.error(e?.message || "Join failed");
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

  if (needsJoin) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10">
          <h2 className="text-xl font-bold text-white mb-4">Join the Pride</h2>
          <p className="text-white/50 text-sm mb-4">
            Choose an alias to start trading
          </p>
          <input
            type="text"
            placeholder="Your alias"
            value={joinAlias}
            onChange={(e) => setJoinAlias(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500 mb-4"
          />
          <button
            onClick={handleJoin}
            disabled={submitting}
            className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all"
          >
            {submitting ? "Joining…" : "Join"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Rocket className="h-6 w-6 text-purple-400" />
        <h1 className="text-2xl font-bold text-white">Launch a Market</h1>
      </div>

      <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10 space-y-5">
        {/* Question */}
        <div>
          <label className="text-sm text-white/60 mb-1 block">Question (Yes/No)</label>
          <input
            type="text"
            placeholder="Will BTC hit 200k by end of 2025?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={200}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500"
          />
          <p className="text-xs text-white/30 mt-1">{question.length}/200</p>
        </div>

        {/* Topic */}
        <div>
          <label className="text-sm text-white/60 mb-1 block">Topic</label>
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500"
          >
            {TOPICS.map((t) => (
              <option key={t} value={t} className="bg-gray-900">
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Evidence URL */}
        <div>
          <label className="text-sm text-white/60 mb-1 block">Evidence URL</label>
          <input
            type="url"
            placeholder="https://example.com/evidence"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500"
          />
          <p className="text-xs text-white/30 mt-1">
            Validators will read this page after close to decide
          </p>
        </div>

        {/* Close date */}
        <div>
          <label className="text-sm text-white/60 mb-1 block">Close Date</label>
          <input
            type="datetime-local"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Wager caps */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-white/60 mb-1 block">Min Wager (GEN)</label>
            <input
              type="number"
              placeholder="0"
              value={minWager}
              onChange={(e) => setMinWager(e.target.value)}
              min="0"
              step="0.01"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="text-sm text-white/60 mb-1 block">Max Wager (GEN)</label>
            <input
              type="number"
              placeholder="0 = uncapped"
              value={maxWager}
              onChange={(e) => setMaxWager(e.target.value)}
              min="0"
              step="0.01"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-yellow-200/70 text-xs">
            Since you control the evidence URL, you will be locked out of betting
            on your own market.
          </p>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
        >
          <Rocket className="h-5 w-5" />
          {submitting ? "Launching…" : "Launch Market"}
        </button>
      </div>
    </div>
  );
}
