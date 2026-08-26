/**
 * Multi-wallet discovery.
 *
 * Primary path is EIP-6963 (multi-wallet injection standard): we broadcast
 * `eip6963:requestProvider` and collect `eip6963:announceProvider` events,
 * giving us a stable rdns, display name and icon per installed wallet.
 * A legacy fallback (window.ethereum / window.rabby sniffing) covers older
 * extensions that have not adopted the standard yet.
 */

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string; // data URI
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: InjectedProvider;
}

/** EIP-1193-ish injected provider shape we rely on. */
export interface InjectedProvider {
  request: (req: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: InjectedProvider[];
}

declare global {
  interface Window {
    ethereum?: InjectedProvider;
    rabby?: InjectedProvider;
  }
}

export interface WalletOption {
  id: string; // rdns when known, else synthetic
  label: string;
  icon?: string; // data URI (EIP-6963)
  emoji: string; // fallback glyph
  provider: InjectedProvider;
}

const announced = new Map<string, EIP6963ProviderDetail>();
let discoveryStarted = false;

export function startDiscovery() {
  if (typeof window === "undefined" || discoveryStarted) return;
  discoveryStarted = true;

  window.addEventListener(
    "eip6963:announceProvider",
    ((event: CustomEvent<EIP6963ProviderDetail>) => {
      if (event.detail?.info?.rdns) {
        announced.set(event.detail.info.rdns, event.detail);
      }
    }) as unknown as EventListener
  );

  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

const FALLBACK_EMOJI: Record<string, string> = {
  "io.metamask": "🦊",
  "io.rabby": "🐰",
  "com.coinbase.wallet": "🔵",
};

function emojiFor(rdns: string): string {
  return FALLBACK_EMOJI[rdns] ?? "🐾";
}

function classifyLegacy(p: InjectedProvider): [string, string, string] | null {
  if (p.isRabby) return ["io.rabby", "Rabby", "🐰"];
  if (p.isCoinbaseWallet) return ["com.coinbase.wallet", "Coinbase Wallet", "🔵"];
  if (p.isMetaMask) return ["io.metamask", "MetaMask", "🦊"];
  return null;
}

/**
 * Enumerate every distinct wallet: EIP-6963 announcements first, then any
 * legacy-only injectors not already covered.
 */
export function detectWallets(): WalletOption[] {
  if (typeof window === "undefined") return [];
  startDiscovery();

  const found = new Map<string, WalletOption>();

  // Modern announcements (available synchronously after the request event).
  for (const [rdns, detail] of announced) {
    found.set(rdns, {
      id: rdns,
      label: detail.info.name,
      icon: detail.info.icon,
      emoji: emojiFor(rdns),
      provider: detail.provider,
    });
  }

  // Legacy fallbacks, deduped against announced wallets.
  const addLegacy = (p: InjectedProvider) => {
    const hit = classifyLegacy(p);
    const id = hit ? hit[0] : "browser";
    if (!found.has(id)) {
      found.set(id, {
        id,
        label: hit ? hit[1] : "Browser Wallet",
        emoji: hit ? hit[2] : "💳",
        provider: p,
      });
    }
  };

  for (const p of window.ethereum?.providers ?? []) addLegacy(p);
  if (window.ethereum) addLegacy(window.ethereum);
  if (window.rabby) addLegacy(window.rabby);

  return [...found.values()];
}

export function hasWalletChoice(): boolean {
  if (typeof window === "undefined") return false;
  return detectWallets().length > 1;
}
