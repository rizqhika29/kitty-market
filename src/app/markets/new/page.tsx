"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Cat,
  Gauge,
  Link2,
  Loader2,
  MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";
import { marketContract, short, toWei, writer } from "@/lib/gl";
import { useSession } from "@/lib/session";
import { TOPICS } from "@/lib/types";

export default function NewMarketPage() {
  const router = useRouter();
  const { account, provider, connect } = useSession();

  const [question, setQuestion] = useState("");
  const [topic, setTopic] = useState<string>("crypto");
  const [sourceUrl, setSourceUrl] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [minWager, setMinWager] = useState("0.001");
  const [maxWager, setMaxWager] = useState("500");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!question.trim() || !sourceUrl.trim() || !closesAt) {
      toast.error("Question, source URL and close date are required");
      return;
    }
    const min = parseFloat(minWager || "0");
    const max = parseFloat(maxWager || "0");
    if (min > max && max > 0) {
      toast.error("Minimum wager can't exceed maximum");
      return;
    }

    if (!account) {
      toast.info("Connecting wallet first…");
      if (!(await connect())) return;
    }

    setBusy(true);
    try {
      const client = writer(account as `0x${string}`, provider);
      const contract = marketContract();
      if (!contract) {
        toast.error("Contract address missing in .env");
        return;
      }

      const ts = Math.floor(new Date(closesAt).getTime() / 1000);

      const txHash = await client.writeContract({
        address: contract as `0x${string}`,
        functionName: "open_market",
        args: [
          question.trim(),
          topic,
          sourceUrl.trim(),
          BigInt(ts),
          toWei(String(min)),
          toWei(String(max)),
        ],
        value: BigInt(0),
      });

      toast.success("Opening market…");
      await client.waitForTransactionReceipt({ hash: txHash });

      toast.success("Market is live! 🐾");
      router.push("/markets");
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error("[new-market] failed:", err);
      toast.error(e.message || "Failed to open market");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      {/* Heading */}
      <div className="text-center">
        <div className="kicker">
          <Cat className="h-3.5 w-3.5" />
          Host a market
        </div>
        <h1 className="mt-5 font-display text-4xl font-bold text-white sm:text-5xl">
          Ask the internet a{" "}
          <span className="text-gradient">yes/no question</span>
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-zinc-400">
          You set the rules — evidence URL, close date, wager caps. The AI
          validators handle the verdict; you just can&apos;t bet on your own
          market.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={submit} className="panel mt-12 space-y-9 rounded-[2rem] p-8 sm:p-10">
        {/* Question */}
        <Field icon={MessageSquareText} label="The Question" tint="text-brand-300 bg-brand-500/15">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Will Bitcoin reach $150k before 2027?"
            maxLength={200}
            required
            className="input-field text-lg"
          />
          <Hint>Must have a definitive yes/no answer · max 200 chars</Hint>
        </Field>

        {/* Topic */}
        <Field icon={Gauge} label="Topic" tint="text-punch-300 bg-punch-500/15">
          <div className="flex flex-wrap gap-2">
            {TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTopic(t)}
                className={
                  topic === t
                    ? "rounded-xl bg-gradient-to-r from-brand-500 to-punch-500 px-4 py-2.5 text-sm font-semibold capitalize text-white shadow-glow"
                    : "rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium capitalize text-zinc-400 transition hover:border-brand-500/40 hover:text-white"
                }
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        {/* Source */}
        <Field icon={Link2} label="Evidence URL" tint="text-emerald-300 bg-emerald-500/15">
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://www.coingecko.com/en/coins/bitcoin"
            required
            className="input-field"
          />
          <Hint>Validators will read this page after close to decide</Hint>
        </Field>

        {/* Deadline */}
        <Field icon={CalendarClock} label="Closes At" tint="text-amber-300 bg-amber-500/15">
          <input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            required
            className="input-field"
          />
          <Hint>Trading stops at this time · within the next year</Hint>
        </Field>

        {/* Wager caps */}
        <Field icon={Gauge} label="Wager Caps (optional)" tint="text-sky-300 bg-sky-500/15">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <input
                type="number"
                step="0.001"
                min="0"
                value={minWager}
                onChange={(e) => setMinWager(e.target.value)}
                className="input-field"
                placeholder="0 for none"
              />
              <Hint>Min stake per position (GEN)</Hint>
            </div>
            <div>
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxWager}
                onChange={(e) => setMaxWager(e.target.value)}
                className="input-field"
                placeholder="0 = uncapped"
              />
              <Hint>Max stake per position (GEN)</Hint>
            </div>
          </div>
          <Hint>
            Set both to 0 for an uncapped market. Caps block single whales from
            dominating the pot.
          </Hint>
        </Field>

        {/* Wallet status */}
        <div className="panel flex items-center justify-between rounded-2xl p-4">
          <span className="text-sm text-zinc-400">Wallet</span>
          {account ? (
            <span className="font-mono text-xs text-emerald-300">
              connected · {short(account, 8, 6)}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              className="btn-ghost !px-4 !py-1.5 text-xs"
            >
              Connect now
            </button>
          )}
        </div>

        <button type="submit" disabled={busy} className="btn-primary w-full !py-4 text-base">
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Opening market…
            </>
          ) : (
            <>
              Launch Market
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        {!account && (
          <p className="-mt-4 text-center text-xs text-zinc-500">
            Your wallet will connect automatically on submit.
          </p>
        )}
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        Not sure how markets resolve?{" "}
        <Link href="/" className="text-brand-300 underline-offset-4 hover:underline">
          Read how it purrs
        </Link>
      </p>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  tint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 text-sm font-semibold text-zinc-200">
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tint}`}>
          <Icon className="h-4 w-4" />
        </span>
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="pl-1 text-xs leading-relaxed text-zinc-500">{children}</p>;
}
