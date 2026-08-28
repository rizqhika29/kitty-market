"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Backpack,
  Coins,
  Loader2,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { marketContract, reader, short, toGen, toWei, writer } from "@/lib/gl";
import { useSession } from "@/lib/session";

interface PositionRow {
  id: string;
  market_id: string;
  size: string;
  side: "yes" | "no";
  closed: boolean;
}

export default function PortfolioPage() {
  const {
    account,
    provider,
    profile,
    joined,
    booting,
    connect,
    disconnect,
    reloadProfile,
  } = useSession();

  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [vault, setVault] = useState("0");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeBusy, setFeeBusy] = useState(false);

  useEffect(() => {
    if (account) {
      void loadPositions();
      void checkAdmin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  async function loadPositions() {
    if (!account) return;
    try {
      const contract = marketContract();
      if (!contract) return;
      const raw = await reader().readContract({
        address: contract as `0x${string}`,
        functionName: "get_trader_positions",
        args: [account],
      });
      if (typeof raw === "string" && raw !== "") setPositions(JSON.parse(raw));
    } catch (e) {
      console.error("[portfolio] positions failed:", e);
    }
  }

  async function checkAdmin() {
    if (!account) return;
    try {
      const contract = marketContract();
      if (!contract) return;
      const client = reader();
      const [ownerRaw, vaultRaw] = await Promise.all([
        client.readContract({
          address: contract as `0x${string}`,
          functionName: "get_owner",
          args: [],
        }),
        client.readContract({
          address: contract as `0x${string}`,
          functionName: "get_fee_balance",
          args: [],
        }),
      ]);
      setIsAdmin(
        String(ownerRaw).toLowerCase() === account.toLowerCase()
      );
      setVault(
        typeof vaultRaw === "bigint"
          ? toGen(vaultRaw.toString(), 4)
          : toGen(String(vaultRaw), 4)
      );
    } catch (e) {
      console.error("[portfolio] admin check failed:", e);
    }
  }

  async function cashOut() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    let useAccount = account;
    let useProvider = provider;
    if (!useAccount) {
      toast.info("Connecting wallet…");
      const fresh = await connect();
      if (!fresh) return;
      useAccount = fresh.account;
      useProvider = fresh.provider;
    }

    setBusy(true);
    try {
      const client = writer(useAccount as `0x${string}`, useProvider);
      const txHash = await client.writeContract({
        address: marketContract() as `0x${string}`,
        functionName: "cash_out",
        args: [toWei(amount)],
        value: BigInt(0),
      });

      toast.success("Cashing out…");
      await client.waitForTransactionReceipt({ hash: txHash });

      toast.success("GEN sent to your wallet!");
      setAmount("");
      await reloadProfile();
      void loadPositions();
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error("[portfolio] cash-out failed:", err);
      toast.error(e.message || "Cash out failed");
    } finally {
      setBusy(false);
    }
  }

  async function collectFees() {
    if (!parseFloat(feeAmount)) {
      toast.error("Enter a valid amount");
      return;
    }

    let useAccount = account;
    let useProvider = provider;
    if (!useAccount) {
      toast.info("Connecting wallet…");
      const fresh = await connect();
      if (!fresh) return;
      useAccount = fresh.account;
      useProvider = fresh.provider;
    }

    setFeeBusy(true);
    try {
      const client = writer(useAccount as `0x${string}`, useProvider);
      const txHash = await client.writeContract({
        address: marketContract() as `0x${string}`,
        functionName: "collect_fees",
        args: [toWei(feeAmount)],
        value: BigInt(0),
      });

      toast.success("Collecting fees…");
      try {
        await client.waitForTransactionReceipt({ hash: txHash });
      } catch {
        /* receipt timeout is non-fatal */
      }

      toast.success("Fees collected!");
      setFeeAmount("");
      void checkAdmin();
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error("[portfolio] fee collection failed:", err);
      toast.error(e.message || "Failed to collect fees");
    } finally {
      setFeeBusy(false);
    }
  }

  if (booting) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <Loader2 className="spin-slow h-9 w-9 text-brand-400" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <div className="panel rounded-[2rem] p-16">
          <Backpack className="mx-auto mb-4 h-14 w-14 text-brand-300" />
          <h1 className="font-display text-2xl font-bold text-white">
            Your backpack awaits
          </h1>
          <p className="mt-3 text-zinc-400">
            Connect a wallet to see your positions, winnings and stats.
          </p>
          <button onClick={() => void connect()} className="btn-primary mt-8">
            <Wallet className="h-4 w-4" />
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      {/* Heading */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="kicker">Your corner</div>
          <h1 className="mt-4 font-display text-4xl font-bold text-white sm:text-5xl">
            {joined && profile ? (
              <>
                Hey,{" "}
                <span className="text-gradient">{profile.name}</span> 🐾
              </>
            ) : (
              <span className="text-gradient">Portfolio</span>
            )}
          </h1>
          <p className="mt-2 font-mono text-sm text-zinc-500">
            {short(account, 10, 8)}
          </p>
        </div>
        <button onClick={disconnect} className="btn-ghost !px-5 !py-2 text-sm">
          Disconnect
        </button>
      </div>

      {/* Stats */}
      {joined && profile && (
        <dl className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Wallet} tint="text-punch-300 bg-punch-500/15" k="Claimable" v={`${toGen(profile.wallet)} GEN`} />
          <StatCard icon={TrendingUp} tint="text-emerald-300 bg-emerald-500/15" k="Lifetime won" v={`${toGen(profile.paid_out)} GEN`} tone="text-emerald-400" />
          <StatCard icon={ArrowDownRight} tint="text-red-300 bg-red-500/15" k="Burned on losses" v={`${toGen(profile.burned)} GEN`} tone="text-red-400" />
          <StatCard icon={Target} tint="text-brand-300 bg-brand-500/15" k="Calls right" v={`${profile.calls_right} / ${profile.calls_total}`} />
        </dl>
      )}

      {/* Cash out */}
      {joined && profile && (
        <div className="panel mt-8 rounded-3xl p-7">
          <h2 className="flex items-center gap-2.5 font-display text-lg font-semibold text-white">
            <Coins className="h-5 w-5 text-punch-300" />
            Cash out to wallet
          </h2>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Available ${toGen(profile.wallet)} GEN`}
              className="input-field flex-1"
            />
            <button onClick={() => void cashOut()} disabled={busy} className="btn-primary sm:!px-9">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Withdraw"}
            </button>
          </div>
        </div>
      )}

      {/* Owner panel */}
      {isAdmin && (
        <div className="panel mt-8 rounded-3xl border border-amber-500/25 p-7">
          <h2 className="font-display text-lg font-semibold text-white">
            Owner · fee vault
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Vault holds <b className="text-amber-300">{vault} GEN</b> in collected fees.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              type="number"
              step="0.01"
              min="0"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              placeholder="Amount in GEN"
              className="input-field flex-1"
            />
            <button onClick={() => void collectFees()} disabled={feeBusy} className="btn-hot sm:!px-9">
              {feeBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Collect"}
            </button>
          </div>
        </div>
      )}

      {/* Positions */}
      <div className="panel mt-8 rounded-3xl p-7">
        <h2 className="font-display text-lg font-semibold text-white">
          Position history
        </h2>

        {positions.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-zinc-400">No positions yet.</p>
            <Link href="/markets" className="btn-ghost mt-6 inline-flex !px-5 !py-2 text-sm">
              Find a market to back
            </Link>
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {positions.slice().reverse().slice(0, 12).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4"
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                      p.side === "yes"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    {p.side === "yes" ? (
                      <ArrowUpRight className="h-5 w-5" />
                    ) : (
                      <ArrowDownRight className="h-5 w-5" />
                    )}
                  </span>
                  <div>
                    <p className="font-medium capitalize text-white">
                      backed {p.side}
                    </p>
                    <Link
                      href={`/markets/${p.market_id}`}
                      className="text-xs text-zinc-500 transition hover:text-brand-300"
                    >
                      market #{p.market_id}
                    </Link>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-white">{toGen(p.size)} GEN</p>
                  <span className={`text-[11px] uppercase tracking-wide ${p.closed ? "text-zinc-500" : "text-punch-300"}`}>
                    {p.closed ? "settled" : "open"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  tint,
  k,
  v,
  tone = "text-white",
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  k: string;
  v: string;
  tone?: string;
}) {
  return (
    <div className="panel rounded-3xl p-6">
      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tint}`}>
        <Icon className="h-5 w-5" />
      </span>
      <dd className={`mt-4 font-display text-2xl font-bold ${tone}`}>{v}</dd>
      <dt className="mt-1 text-sm text-zinc-500">{k}</dt>
    </div>
  );
}
