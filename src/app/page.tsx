"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Coins,
  Fingerprint,
  Globe2,
  PawPrint,
  Rocket,
  ShieldCheck,
  Sparkles,
  Store,
  Swords,
  TrendingUp,
} from "lucide-react";
import { marketContract, reader } from "@/lib/gl";

const tickerItems = [
  "Will ETH flip $10k before 2027?",
  "Champions League winner this season?",
  "Next country to regulate AI?",
  "GPT-5 released before March?",
  "BTC above $150k on Dec 31?",
  "New iPhone under $600?",
  "Will fusion hit Q>1 again in 2026?",
];

const steps = [
  {
    n: "01",
    icon: Store,
    title: "Open",
    body: "Anyone posts a yes/no question with an evidence URL and a close date. Set optional wager caps to keep whales out.",
  },
  {
    n: "02",
    icon: Swords,
    title: "Take a Side",
    body: "Back YES or NO with GEN. Odds shift live as the pools grow. Hosts can't trade their own markets.",
  },
  {
    n: "03",
    icon: Brain,
    title: "AI Judges",
    body: "After close, validators independently fetch the evidence page and reason over it. Consensus settles the truth.",
  },
  {
    n: "04",
    icon: Coins,
    title: "Collect",
    body: "Winners split the whole pot pro-rata. If evidence is unreadable, everyone walks away whole.",
  },
];

const bento = [
  {
    icon: Globe2,
    title: "Any URL is an oracle",
    body: "Point a market at any public webpage — price tickers, news wires, scoreboards. No whitelists, no middlemen.",
    span: "md:col-span-2",
    tint: "from-brand-500/20",
  },
  {
    icon: ShieldCheck,
    title: "Greyboxed reasoning",
    body: "Page content is treated as inert text, never instructions — prompt injection dies here.",
    span: "",
    tint: "from-punch-500/20",
  },
  {
    icon: Fingerprint,
    title: "Wager caps per market",
    body: "Hosts set min/max stake bounds, so one whale can't own the pot.",
    span: "",
    tint: "from-violet-500/20",
  },
  {
    icon: TrendingUp,
    title: "Voided, never frozen",
    body: "If the AI can't reach a verdict, every stake is reclaimable in full. Funds never get stuck.",
    span: "md:col-span-3",
    tint: "from-fuchsia-500/15",
  },
];

const topics = [
  { name: "Crypto", emoji: "🪙" },
  { name: "Sports", emoji: "🏟️" },
  { name: "Politics", emoji: "🗳️" },
  { name: "Entertainment", emoji: "🎬" },
  { name: "Tech", emoji: "🤖" },
  { name: "Science", emoji: "🔬" },
  { name: "Other", emoji: "🐾" },
];

function useLiveStats() {
  const [stats, setStats] = useState([
    { label: "Markets opened", value: "—" },
    { label: "Positions taken", value: "—" },
    { label: "Cats in the pride", value: "—" },
    { label: "Settlement fee", value: "2%" },
  ]);

  useEffect(() => {
    const contract = marketContract();
    if (!contract) return;
    (async () => {
      try {
        const client = reader();
        const [m, w, u] = await Promise.all([
          client.readContract({
            address: contract as `0x${string}`,
            functionName: "get_total_markets",
            args: [],
          }),
          client.readContract({
            address: contract as `0x${string}`,
            functionName: "get_total_wagers",
            args: [],
          }),
          client.readContract({
            address: contract as `0x${string}`,
            functionName: "get_total_traders",
            args: [],
          }),
        ]);
        const num = (v: unknown) =>
          typeof v === "bigint" ? v.toString() : String(v);
        setStats((s) => [
          { ...s[0], value: num(m) },
          { ...s[1], value: num(w) },
          { ...s[2], value: num(u) },
          s[3],
        ]);
      } catch (e) {
        console.error("[landing] stats failed:", e);
      }
    })();
  }, []);

  return stats;
}

export default function HomePage() {
  const stats = useLiveStats();

  return (
    <div>
      {/* ═══════════════ HERO ═══════════════ */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-20 sm:pt-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Copy */}
          <div>
            <div className="kicker animate-rise">
              <PawPrint className="h-3.5 w-3.5" />
              Curiosity pays
            </div>

            <h1 className="animate-rise delay-1 mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Bet on the truth.
              <br />
              <span className="text-gradient">Let AI fetch it.</span>
            </h1>

            <p className="animate-rise delay-2 mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
              Kitty Market runs prediction markets where the verdict comes
              from <span className="text-zinc-200">decentralized AI validators</span>{" "}
              reading real web pages — not from a company oracle you have to
              trust.
            </p>

            <div className="animate-rise delay-3 mt-9 flex flex-wrap items-center gap-4">
              <Link href="/markets" className="btn-primary text-base">
                Browse Markets
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/markets/new" className="btn-ghost text-base">
                <Rocket className="h-4 w-4" />
                Open a Market
              </Link>
            </div>

            {/* Stats */}
            <dl className="animate-rise delay-3 mt-12 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-xs uppercase tracking-wider text-zinc-500">
                    {s.label}
                  </dt>
                  <dd className="text-gradient mt-1 font-display text-4xl font-bold">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Mock market panel */}
          <div className="animate-rise delay-2 relative mx-auto w-full max-w-md">
            <div className="absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-brand-500/25 via-transparent to-punch-500/25 blur-2xl" />
            <div className="panel relative rounded-[2rem] p-7 shadow-glow">
              <div className="flex items-center justify-between">
                <span className="topic-tag">crypto</span>
                <span className="status-chip bg-emerald-500/15 text-emerald-300">
                  LIVE
                </span>
              </div>

              <p className="mt-5 font-display text-xl font-semibold leading-snug text-white">
                Will BTC close above $120k on New Year&apos;s Eve?
              </p>

              <div className="mt-6 flex items-end justify-between text-sm">
                <div>
                  <span className="font-display text-3xl font-bold text-emerald-400">
                    62%
                  </span>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">YES</p>
                </div>
                <Swords className="mb-1 h-5 w-5 text-zinc-600" />
                <div className="text-right">
                  <span className="font-display text-3xl font-bold text-red-400">
                    38%
                  </span>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">NO</p>
                </div>
              </div>

              <div className="mt-3 flex h-3 gap-px overflow-hidden rounded-full bg-white/5">
                <div className="w-[62%] bg-gradient-to-r from-emerald-600 to-emerald-400" />
                <div className="w-[38%] bg-gradient-to-r from-red-400 to-rose-600" />
              </div>

              <div className="mt-6 space-y-2.5 border-t border-white/5 pt-5 text-sm">
                <Row k="Pot" v="4,820 GEN" />
                <Row k="Closes" v="Dec 31, 23:59 UTC" />
                <Row k="Caps" v="min 1 / max 500 GEN" />
                <Row k="Resolver" v="AI validators × N" />
              </div>

              <div className="mt-6 flex gap-3">
                <button className="side-btn !border-emerald-500/40 !bg-emerald-500/10 !text-emerald-300">
                  YES
                </button>
                <button className="side-btn !border-red-500/40 !bg-red-500/10 !text-red-300">
                  NO
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ TICKER ═══════════════ */}
      <section className="ticker-mask overflow-hidden border-y border-white/5 py-4">
        <div className="ticker-track gap-10 pr-10">
          {[...tickerItems, ...tickerItems].map((q, i) => (
            <span
              key={i}
              className="flex shrink-0 items-center gap-3 text-sm text-zinc-500"
            >
              <Sparkles className="h-3.5 w-3.5 text-brand-400" />
              {q}
            </span>
          ))}
        </div>
      </section>

      {/* ═══════════════ HOW IT PURRS ═══════════════ */}
      <section className="section-pad">
        <div className="max-w-2xl">
          <div className="kicker">How it purrs</div>
          <h2 className="mt-4 font-display text-4xl font-bold text-white sm:text-5xl">
            Four steps from question to payout
          </h2>
        </div>

        <ol className="relative mt-14 grid gap-6 md:grid-cols-4">
          <div className="absolute left-0 right-0 top-10 hidden h-px bg-gradient-to-r from-brand-500/40 via-punch-500/40 to-transparent md:block" />
          {steps.map((s) => (
            <li key={s.n} className="panel panel-hover relative rounded-3xl p-7">
              <span className="text-gradient absolute right-6 top-5 font-display text-4xl font-bold opacity-40">
                {s.n}
              </span>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-punch-500 shadow-glow">
                <s.icon className="h-5 w-5 text-white" />
              </span>
              <h3 className="mt-5 font-display text-lg font-semibold text-white">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ═══════════════ BENTO FEATURES ═══════════════ */}
      <section className="section-pad pt-0">
        <div className="grid gap-5 md:grid-cols-3">
          {bento.map((f) => (
            <article key={f.title} className={`panel panel-hover relative overflow-hidden rounded-3xl p-8 ${f.span}`}>
              <div
                className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br ${f.tint} to-transparent blur-3xl`}
              />
              <f.icon className="h-7 w-7 text-punch-300" />
              <h3 className="mt-5 font-display text-xl font-semibold text-white">
                {f.title}
              </h3>
              <p className="mt-2 leading-relaxed text-zinc-400">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ═══════════════ TOPICS ═══════════════ */}
      <section className="section-pad pt-0">
        <div className="panel overflow-hidden rounded-[2.5rem] p-10 sm:p-14">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <div className="kicker">Nine lives, endless topics</div>
              <h2 className="mt-4 font-display text-4xl font-bold text-white">
                Predict anything with a source
              </h2>
              <ul className="mt-8 space-y-3.5">
                {[
                  "Validators run different models and must agree",
                  "Equivalence Principle keeps consensus honest",
                  "Everything settles on GenLayer, an AI-native chain",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-3 text-zinc-300">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-punch-400" />
                    {line}
                  </li>
                ))}
              </ul>
              <Link href="/markets/new" className="btn-hot mt-9">
                Launch your first market
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              {topics.map((t) => (
                <Link
                  key={t.name}
                  href={`/markets?topic=${t.name.toLowerCase()}`}
                  className="panel panel-hover flex flex-col items-center gap-2 rounded-2xl px-4 py-6"
                >
                  <span className="text-3xl">{t.emoji}</span>
                  <span className="text-sm font-medium capitalize text-zinc-300">
                    {t.name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ FOOTER ═══════════════ */}
      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="brand-badge !h-9 !w-9 !rounded-xl">
              <PawPrint className="h-4 w-4 text-white" />
            </span>
            <span className="font-display font-bold text-white">
              Kitty<span className="text-gradient">Market</span>
            </span>
          </div>
          <p className="text-sm text-zinc-500">
            Built on GenLayer · verdicts fetched by AI validators · loved by cats
          </p>
          <div className="flex gap-6 text-sm text-zinc-400">
            <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="transition hover:text-white">
              GenLayer
            </a>
            <a href="https://docs.genlayer.com" target="_blank" rel="noopener noreferrer" className="transition hover:text-white">
              Docs
            </a>
            <a href="https://explorer-studio.genlayer.com" target="_blank" rel="noopener noreferrer" className="transition hover:text-white">
              Explorer
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{k}</span>
      <span className="font-medium text-zinc-200">{v}</span>
    </div>
  );
}
