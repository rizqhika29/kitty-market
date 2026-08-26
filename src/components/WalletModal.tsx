"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import {
  detectWallets,
  startDiscovery,
  type InjectedProvider,
  type WalletOption,
} from "@/lib/wallets";

interface Props {
  /** Optional pre-computed list; otherwise discovery runs here. */
  wallets?: WalletOption[];
  onPick: (provider: InjectedProvider) => void;
  onClose: () => void;
}

/**
 * EIP-6963 announcements arrive as events, so we give the bus a brief
 * moment to deliver them before showing the list.
 */
export function WalletModal({ wallets, onPick, onClose }: Props) {
  const [options, setOptions] = useState<WalletOption[]>(wallets ?? []);

  useEffect(() => {
    if (wallets) return;
    startDiscovery();
    const t = setTimeout(() => setOptions(detectWallets()), 350);
    return () => clearTimeout(t);
  }, [wallets]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="dialog-pop relative w-full max-w-sm rounded-3xl p-6">
        <h2 className="font-display text-lg font-bold text-white">Pick your wallet</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Every wallet installed in this browser shows up here.
        </p>

        {options.length === 0 ? (
          <div className="py-10 text-center">
            <Wallet className="mx-auto mb-3 h-12 w-12 text-zinc-600" />
            <p className="text-zinc-300">No wallet found</p>
            <p className="mt-1 text-sm text-zinc-500">
              Install MetaMask, Rabby, or Coinbase Wallet first.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-2">
            {options.map((w) => (
              <button
                key={w.id}
                onClick={() => onPick(w.provider)}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-left transition-all hover:border-brand-500/60 hover:bg-brand-500/10"
              >
                {w.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.icon} alt="" width={26} height={26} className="h-[26px] w-[26px]" />
                ) : (
                  <span className="text-2xl">{w.emoji}</span>
                )}
                <span className="font-medium text-white">{w.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
