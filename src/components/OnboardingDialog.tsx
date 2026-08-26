"use client";

import { useState } from "react";
import { Cat, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { marketContract, writer } from "@/lib/gl";
import { useSession } from "@/lib/session";

interface Props {
  onDone: () => void;
  onClose: () => void;
}

export function OnboardingDialog({ onDone, onClose }: Props) {
  const { account, provider } = useSession();
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!alias.trim()) {
      toast.error("Pick an alias first");
      return;
    }

    setBusy(true);
    try {
      if (provider) {
        await provider.request({ method: "eth_requestAccounts" });
      }
      const client = writer(account as `0x${string}`, provider);
      const contract = marketContract();

      const txHash = await client.writeContract({
        address: contract as `0x${string}`,
        functionName: "join",
        args: [alias.trim()],
        value: BigInt(0),
      });

      toast.success("Joining the pride…");
      await client.waitForTransactionReceipt({ hash: txHash });

      toast.success(`Welcome aboard, ${alias.trim()}!`);
      onDone();
    } catch (err: unknown) {
      const e = err as { message?: string; code?: number };
      console.error("[onboarding] failed:", err);
      if (e.message?.includes("not been authorized") || e.code === 4001) {
        toast.error("Transaction rejected in your wallet.");
      } else {
        toast.error(e.message || "Failed to join");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="dialog-pop relative w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-500/25 to-punch-500/25">
          <Cat className="h-10 w-10 text-punch-300" />
        </div>

        <h2 className="font-display text-2xl font-bold text-white">
          A cat needs a name
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Claim an alias to open markets, take sides, and climb the Top Cats board.
        </p>

        <input
          type="text"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="e.g. WhiskersAlpha"
          maxLength={32}
          className="input-field mt-6"
        />
        <p className="-mt-2 mb-5 text-xs text-zinc-500">1–32 characters</p>

        <button
          onClick={() => void submit()}
          disabled={busy || !alias.trim()}
          className="btn-primary flex w-full items-center justify-center gap-2"
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Joining…
            </>
          ) : (
            "Claim My Alias"
          )}
        </button>

        <p className="mt-4 font-mono text-xs text-zinc-600">
          {account?.slice(0, 8)}…{account?.slice(-6)}
        </p>
      </div>
    </div>
  );
}
