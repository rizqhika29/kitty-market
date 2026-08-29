"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  Coins,
  ExternalLink,
  Hourglass,
  Loader2,
  Swords,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { marketContract, reader, toGen, toWei, writer } from "@/lib/gl";
import { useSession } from "@/lib/session";
import type { InjectedProvider } from "@/lib/wallets";
import type { Market, Position } from "@/lib/types";
import { formatClose, isExpired, parseSourceUrls, splitPools } from "@/lib/types";

export default function MarketDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { account, provider, connect } = useSession();

  const [market, setMarket] = useState<Market | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  const [side, setSide] = useState<"yes" | "no">("yes");
  const [stake, setStake] = useState("");
  const [busy, setBusy] = useState<null | "stake" | "settle" | "claim" | "reclaim">(null);
  const [phaseNote, setPhaseNote] = useState("");

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadMarket = useCallback(async () => {
    try {
      const contract = marketContract();
      if (!contract) return null;
      const raw = await reader().readContract({
        address: contract as `0x${string}`,
        functionName: "get_market",
        args: [id],
      });
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw) as Market;
        if (alive.current) setMarket(parsed);
        return parsed;
      }
      if (raw && typeof raw === "object") {
        const parsed = raw as unknown as Market;
        if (alive.current) setMarket(parsed);
        return parsed;
      }
    } catch (e) {
      console.error("[market] load failed:", e);
    }
    return null;
  }, [id]);

  const loadPositions = useCallback(async () => {
    if (!account) return;
    try {
      const contract = marketContract();
      if (!contract) return;
      const raw = await reader().readContract({
        address: contract as `0x${string}`,
        functionName: "get_trader_positions",
        args: [account],
      });
      if (typeof raw === "string" && raw !== "") {
        const all = JSON.parse(raw) as Position[];
        if (alive.current)
          setPositions(all.filter((p) => p.market_id === id));
      }
    } catch (e) {
      console.error("[market] positions failed:", e);
    }
  }, [account, id]);

  useEffect(() => {
    (async () => {
      await loadMarket();
      await loadPositions();
      if (alive.current) setLoading(false);
    })();
  }, [loadMarket, loadPositions]);

  async function ensureWallet(): Promise<{ addr: string; prov: InjectedProvider } | null> {
    if (account && provider) return { addr: account, prov: provider };
    toast.info("Connecting wallet…");
    const fresh = await connect();
    if (!fresh) return null;
    return { addr: fresh.account, prov: fresh.provider };
  }

  async function takeSide() {
    const amount = parseFloat(stake);
    if (!amount || amount <= 0) {
      toast.error("Enter a stake amount");
      return;
    }
    const wallet = await ensureWallet();
    if (!wallet) return;

    // Client-side cap check for fast feedback.
    if (market) {
      const minW = parseInt(market.min_wager || "0");
      const maxW = parseInt(market.max_wager || "0");
      const wei = toWei(stake);
      if (maxW > 0n) {
        const floor = minW > 0 ? minW : 1;
        if (wei < BigInt(floor)) {
          toast.error(`Minimum stake is ${toGen(market.min_wager)} GEN`);
          return;
        }
        if (wei > BigInt(maxW)) {
          toast.error(`Maximum stake is ${toGen(market.max_wager)} GEN`);
          return;
        }
      }
    }

    setBusy("stake");
    try {
      const client = writer(wallet.addr, wallet.prov);
      const txHash = await client.writeContract({
        address: marketContract() as `0x${string}`,
        functionName: "take_side",
        args: [id, side],
        value: toWei(stake),
      });

      toast.success("Staking…");
      await client.waitForTransactionReceipt({ hash: txHash });

      toast.success(`You're on ${side.toUpperCase()}! 🐾`);
      setStake("");
      await loadMarket();
      await loadPositions();
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error("[market] stake failed:", err);
      toast.error(e.message || "Failed to stake");
    } finally {
      setBusy(null);
    }
  }

  async function settle() {
    const wallet = await ensureWallet();
    if (!wallet) return;

    setBusy("settle");
    setPhaseNote("Sending settlement transaction…");
    try {
      const client = writer(wallet.addr, wallet.prov);
      const txHash = await client.writeContract({
        address: marketContract() as `0x${string}`,
        functionName: "settle_market",
        args: [id],
        value: BigInt(0),
      });

      toast.success("Validators are fetching the evidence…");
      setPhaseNote("Waiting for AI consensus (can take a couple of minutes)…");

      for (let i = 0; i < 36; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        if (!alive.current) return;
        const m = await loadMarket();
        if (m?.settled) {
          if (m.outcome === "void") {
            toast.info("Verdict was inconclusive — all stakes are reclaimable.");
          } else {
            toast.success(`Verdict in: ${m.outcome.toUpperCase()} wins!`);
          }
          return;
        }
      }

      toast.warning("Consensus still running — refresh in a moment.");
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error("[market] settle failed:", err);
      toast.error(e.message || "Settlement failed");
    } finally {
      setBusy(null);
      setPhaseNote("");
    }
  }

  async function claimPayout() {
    const wallet = await ensureWallet();
    if (!wallet) return;
    setBusy("claim");
    try {
      const client = writer(wallet.addr, wallet.prov);
      const txHash = await client.writeContract({
        address: marketContract() as `0x${string}`,
        functionName: "claim_payout",
        args: [id],
        value: BigInt(0),
      });

      toast.success("Claiming payout…");
      try {
        await client.waitForTransactionReceipt({ hash: txHash });
      } catch (e) {
        console.error("[market] receipt failed:", e);
        toast.error("Couldn't confirm the claim. Refresh to check on-chain state.");
        await loadPositions();
        return;
      }

      toast.success("Winnings secured! 💰");
      await loadPositions();
      await loadMarket();
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error("[market] claim failed:", err);
      toast.error(e.message || "Claim failed");
    } finally {
      setBusy(null);
    }
  }

  async function reclaim() {
    const wallet = await ensureWallet();
    if (!wallet) return;
    setBusy("reclaim");
    try {
      const client = writer(wallet.addr, wallet.prov);
      const txHash = await client.writeContract({
        address: marketContract() as `0x${string}`,
        functionName: "reclaim_stake",
        args: [id],
        value: BigInt(0),
      });

      toast.success("Reclaiming stake…");
      try {
        await client.waitForTransactionReceipt({ hash: txHash });
      } catch (e) {
        console.error("[market] receipt failed:", e);
        toast.error("Couldn't confirm. Refresh to check on-chain state.");
        await loadPositions();
        return;
      }

      toast.success("Full stake returned!");
      await loadPositions();
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error("[market] reclaim failed:", err);
      toast.error(e.message || "Reclaim failed");
    } finally {
      setBusy(null);
    }
  }

  /* ── Render states ─────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <Loader2 className="spin-slow h-9 w-9 text-brand-400" />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <div className="panel rounded-[2rem] p-14">
          <AlertTriangle className="mx-auto mb-4 h-14 w-14 text-red-400" />
          <h1 className="font-display text-2xl font-bold text-white">
            This market wandered off
          </h1>
          <p className="mt-2 text-zinc-400">It doesn&apos;t exist (yet?).</p>
          <Link href="/markets" className="btn-primary mt-7 inline-flex">
            <ArrowLeft className="h-4 w-4" />
            Back to markets
          </Link>
        </div>
      </div>
    );
  }

  const { yesPct, total } = splitPools(market);
  const expired = isExpired(market);

  const mine = positions.length > 0;
  const open = positions.filter((p) => !p.closed);
  const openWinners =
    market.settled && market.outcome !== "void"
      ? open.filter((p) => p.side === market.outcome)
      : [];
  const stakedTotal = positions.reduce((s, p) => s + parseInt(p.size || "0"), 0);
  const yesMine = positions
    .filter((p) => p.side === "yes")
    .reduce((s, p) => s + parseInt(p.size || "0"), 0);
  const noMine = positions
    .filter((p) => p.side === "no")
    .reduce((s, p) => s + parseInt(p.size || "0"), 0);

  const isHost =
    !!account && !!market.host && account.toLowerCase() === market.host.toLowerCase();

  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <Link
        href="/markets"
        className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> All markets
      </Link>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        {/* ═══ LEFT: market info ═══ */}
        <div className="space-y-6">
          <div className="panel rounded-[2rem] p-8 sm:p-10">
            {/* chips */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="topic-tag">{market.topic}</span>
              {market.settled ? (
                market.outcome === "void" ? (
                  <Chip tone="zinc">VOIDED</Chip>
                ) : (
                  <Chip tone={market.outcome === "yes" ? "emerald" : "red"}>
                    {market.outcome.toUpperCase()} WINS
                  </Chip>
                )
              ) : expired ? (
                <Chip tone="amber">AWAITING AI</Chip>
              ) : (
                <Chip tone="brand">TRADING</Chip>
              )}
            </div>

            <h1 className="mt-5 font-display text-2xl font-bold leading-snug text-white sm:text-3xl">
              {market.question}
            </h1>

            {/* odds */}
            <div className="panel mt-7 rounded-2xl p-6">
              <div className="flex items-center justify-between text-center">
                <div className="flex-1">
                  <p className="font-display text-3xl font-bold text-emerald-400">
                    {yesPct.toFixed(0)}%
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
                    YES · {toGen(market.yes_pool)} GEN
                  </p>
                </div>
                <Swords className="h-5 w-5 shrink-0 text-zinc-600" />
                <div className="flex-1">
                  <p className="font-display text-3xl font-bold text-red-400">
                    {(100 - yesPct).toFixed(0)}%
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
                    NO · {toGen(market.no_pool)} GEN
                  </p>
                </div>
              </div>
              <div className="mt-4 flex h-3 gap-px overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
                  style={{ width: `${yesPct}%` }}
                />
                <div
                  className="h-full bg-gradient-to-r from-red-400 to-rose-600 transition-all duration-700"
                  style={{ width: `${100 - yesPct}%` }}
                />
              </div>
            </div>

            {/* meta grid */}
            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Meta icon={Hourglass} k="Closes" v={formatClose(market.closes_at)} />
              <Meta icon={Coins} k="Pot" v={`${toGen(market.pool)} GEN`} />
              <Meta
                icon={Swords}
                k="Caps"
                v={
                  parseInt(market.max_wager || "0") > 0
                    ? `${parseInt(market.min_wager) > 0 ? toGen(market.min_wager) : "0"}–${toGen(market.max_wager)}`
                    : "uncapped"
                }
              />
              <Meta
                icon={ExternalLink}
                k="Sources"
                v={
                  <div className="space-y-1">
                    {parseSourceUrls(market.source_urls).map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-brand-300 hover:text-punch-300"
                      >
                        {safeHost(url)}
                      </a>
                    ))}
                  </div>
                }
              />
            </dl>

            {/* AI verdict */}
            {market.settled && market.verdict_note && (
              <div className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-6">
                <h3 className="flex items-center gap-2.5 font-display font-semibold text-white">
                  <Brain className="h-5 w-5 text-amber-300" />
                  {market.outcome === "void" ? "Why the AI found this inconclusive" : "Why the AI decided this"}
                </h3>
                <p className="mt-3 leading-relaxed text-zinc-300">
                  {market.verdict_note}
                </p>
              </div>
            )}
          </div>

          {/* Host notice */}
          {!market.settled && !expired && isHost && (
            <div className="panel rounded-[2rem] p-8 text-center">
              <Cat_ className="mx-auto mb-3 h-10 w-10 text-brand-300" />
              <h2 className="font-display text-lg font-semibold text-white">
                You&apos;re hosting this one
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
                Since you control the evidence sources, the contract locks you out
                of taking a side here.
              </p>
            </div>
          )}

          {/* My positions summary */}
          {mine && (
            <div className="panel rounded-[2rem] p-8">
              <h2 className="font-display text-lg font-semibold text-white">
                Your positions
              </h2>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <Stat k="YES" v={`${toGen(String(yesMine), 4)}`} tone="text-emerald-400" />
                <Stat k="NO" v={`${toGen(String(noMine), 4)}`} tone="text-red-400" />
                <Stat k="Open" v={String(open.length)} tone="text-zinc-200" />
              </div>
            </div>
          )}
        </div>

        {/* ═══ RIGHT: actions ═══ */}
        <div className="space-y-6 lg:sticky lg:top-28 lg:self-start">
          {/* Take a side */}
          {!market.settled && !expired && !isHost && (
            <div className="panel rounded-[2rem] p-8">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
                <Swords className="h-5 w-5 text-punch-300" />
                Take a side
              </h2>

              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setSide("yes")}
                  disabled={busy !== null}
                  className={`side-btn ${
                    side === "yes"
                      ? "!border-emerald-500/60 !bg-emerald-500/15 !text-emerald-300 shadow-glow"
                      : ""
                  }`}
                >
                  YES
                </button>
                <button
                  onClick={() => setSide("no")}
                  disabled={busy !== null}
                  className={`side-btn ${
                    side === "no"
                      ? "!border-red-500/60 !bg-red-500/15 !text-red-300 shadow-glow"
                      : ""
                  }`}
                >
                  NO
                </button>
              </div>

              <div className="mt-4 flex gap-3">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  placeholder="Stake in GEN"
                  className="input-field flex-1"
                />
                <button
                  onClick={() => void takeSide()}
                  disabled={busy !== null || !stake}
                  className="btn-primary !px-6"
                >
                  {busy === "stake" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    "Stake"
                  )}
                </button>
              </div>

              {parseInt(market.max_wager || "0") > 0 && (
                <p className="mt-3 text-xs text-zinc-500">
                  Limits here: min{" "}
                  {parseInt(market.min_wager) > 0 ? toGen(market.min_wager) : "any"} ·
                  max {toGen(market.max_wager)} GEN
                </p>
              )}
            </div>
          )}

          {/* Settle */}
          {!market.settled && expired && (
            <div className="panel rounded-[2rem] p-8 text-center">
              <Brain className="spin-slow mx-auto mb-3 h-11 w-11 text-amber-300" />
              <h2 className="font-display text-lg font-semibold text-white">
                Trading is closed
              </h2>
              <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-400">
                Anyone can now trigger the AI verdict.
              </p>
              <button
                onClick={() => void settle()}
                disabled={busy !== null}
                className="btn-hot mt-6 w-full"
              >
                {busy === "settle" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Resolving…
                  </>
                ) : (
                  <>
                    <Brain className="h-4 w-4" />
                    Ask the AI
                  </>
                )}
              </button>
              {busy === "settle" && phaseNote && (
                <p className="mt-4 flex items-center justify-center gap-2 text-xs text-amber-200">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {phaseNote}
                </p>
              )}
            </div>
          )}

          {/* Claim payout */}
          {market.settled && market.outcome !== "void" && mine && openWinners.length > 0 && (
            <div className="panel rounded-[2rem] border border-emerald-500/30 p-8 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
              <h2 className="font-display text-xl font-bold text-white">
                You called it — {market.outcome.toUpperCase()}
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                {openWinners.length} winning position
                {openWinners.length > 1 ? "s" : ""} ready to collect.
              </p>
              <button
                onClick={() => void claimPayout()}
                disabled={busy !== null}
                className="btn-primary mt-6 w-full"
              >
                {busy === "claim" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Collecting…
                  </>
                ) : (
                  <>
                    <Coins className="h-4 w-4" />
                    Collect Winnings
                  </>
                )}
              </button>
            </div>
          )}

          {/* Reclaim after void */}
          {market.settled && market.outcome === "void" && mine && open.length > 0 && (
            <div className="panel rounded-[2rem] border border-zinc-500/25 p-8 text-center">
              <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-zinc-400" />
              <h2 className="font-display text-xl font-bold text-white">
                Verdict: void
              </h2>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-400">
                No definitive answer — your full{" "}
                <b className="text-white">{toGen(String(stakedTotal))} GEN</b> is
                reclaimable.
              </p>
              <button
                onClick={() => void reclaim()}
                disabled={busy !== null}
                className="btn-hot mt-6 w-full"
              >
                {busy === "reclaim" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Reclaiming…
                  </>
                ) : (
                  "Reclaim My Stake"
                )}
              </button>
            </div>
          )}

          {/* Settled, nothing to do */}
          {market.settled && mine && open.length === 0 && (
            <div className="panel rounded-[2rem] p-8 text-center">
              {openWinners.length === 0 &&
                (positions.some((p) => market.outcome !== "void" && p.side === market.outcome) ? (
                  <>
                    <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-brand-300" />
                    <h2 className="font-display text-lg font-semibold text-white">
                      Already collected
                    </h2>
                    <p className="mt-2 text-sm text-zinc-400">
                      Your winnings from this market are in your wallet balance.
                    </p>
                  </>
                ) : (
                  <>
                    <XCircle className="mx-auto mb-3 h-12 w-12 text-red-400" />
                    <h2 className="font-display text-lg font-semibold text-white">
                      Called the wrong side
                    </h2>
                    <p className="mt-2 text-sm text-zinc-400">
                      Nine lives — there&apos;s always the next market.
                    </p>
                  </>
                ))}
            </div>
          )}

          {/* Spectator on settled market */}
          {market.settled && !mine && (
            <div className="panel rounded-[2rem] p-8 text-center">
              <Coins className="mx-auto mb-3 h-11 w-11 text-zinc-500" />
              <h2 className="font-display text-lg font-semibold text-white">
                {market.outcome === "void" ? "This one voided" : `Settled: ${market.outcome.toUpperCase()}`}
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                You didn&apos;t hold a position here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── small presentational helpers ─────────────────────────────────── */

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "emerald" | "red" | "amber" | "zinc" | "brand";
}) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-300",
    red: "bg-red-500/15 text-red-300",
    amber: "bg-amber-500/15 text-amber-300",
    zinc: "bg-zinc-500/15 text-zinc-300",
    brand: "bg-brand-500/15 text-brand-200",
  };
  return (
    <span className={`status-chip ${tones[tone]}`}>{children}</span>
  );
}

function Meta({
  icon: Icon,
  k,
  v,
}: {
  icon: React.ComponentType<{ className?: string }>;
  k: string;
  v: React.ReactNode;
}) {
  return (
    <div className="panel rounded-2xl p-4 text-center">
      <Icon className="mx-auto mb-2 h-5 w-5 text-zinc-500" />
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-zinc-100">{v}</dd>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 py-4">
      <p className={`font-display text-xl font-bold ${tone}`}>{v}</p>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{k}</p>
    </div>
  );
}

function Cat_({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M4 13a8 8 0 0 1 16 0v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-3Z" strokeLinejoin="round" />
      <path d="M6 8 5 3l4 2.5M18 8l1-5-4 2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="13" r="0.6" fill="currentColor" />
      <circle cx="14.5" cy="13" r="0.6" fill="currentColor" />
    </svg>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 30);
  }
}
