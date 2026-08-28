"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { marketContract, NETWORK, reader, writer, invalidateWriter } from "@/lib/gl";
import {
  hasWalletChoice,
  type InjectedProvider,
} from "@/lib/wallets";
import { WalletModal } from "@/components/WalletModal";
import { OnboardingDialog } from "@/components/OnboardingDialog";

export interface TraderProfile {
  name: string;
  wallet: string;
  paid_out: string;
  burned: string;
  markets_opened: string;
  calls_right: string;
  calls_total: string;
}

export interface SessionValue {
  account: string | null;
  provider: InjectedProvider | null;
  profile: TraderProfile | null;
  joined: boolean;
  booting: boolean;
  connect: () => Promise<{ account: string; provider: InjectedProvider } | null>;
  disconnect: () => void;
  reloadProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  account: null,
  provider: null,
  profile: null,
  joined: false,
  booting: true,
  connect: async () => null,
  disconnect: () => {},
  reloadProfile: async () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

async function switchToGenLayer(provider: InjectedProvider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: NETWORK.chainIdHex }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 4902) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: NETWORK.chainIdHex,
              chainName: NETWORK.label,
              nativeCurrency: {
                name: NETWORK.symbol,
                symbol: NETWORK.symbol,
                decimals: 18,
              },
              rpcUrls: [NETWORK.rpc],
              blockExplorerUrls: [NETWORK.explorer],
            },
          ],
        });
      } catch {
        // wallet may not support adding chains; ignore
      }
    }
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<InjectedProvider | null>(null);
  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const connectResolver = useRef<((v: { account: string; provider: InjectedProvider } | null) => void) | null>(null);

  const fetchProfile = useCallback(async (addr: string) => {
    const contract = marketContract();
    if (!contract) {
      setBooting(false);
      return;
    }
    try {
      const raw = await reader().readContract({
        address: contract as `0x${string}`,
        functionName: "get_trader_info",
        args: [addr],
      });

      if (typeof raw === "string" && raw !== "unknown trader" && raw !== "") {
        setProfile(JSON.parse(raw));
        setOnboardOpen(false);
      } else {
        setProfile(null);
        setOnboardOpen(true);
      }
    } catch (e) {
      console.error("[session] profile lookup failed:", e);
      setProfile(null);
      setOnboardOpen(true);
    } finally {
      setBooting(false);
    }
  }, []);

  const adoptProvider = useCallback(
    async (wallet: InjectedProvider): Promise<{ account: string; provider: InjectedProvider } | null> => {
      try {
        const accounts = (await wallet.request({
          method: "eth_requestAccounts",
        })) as string[];

        setAccount(accounts[0]);
        setProvider(wallet);
        setBooting(false);

        await switchToGenLayer(wallet);

        // Eagerly initialise the SDK writer so the first real write
        // does not fail due to un-initialised provider state.
        try {
          writer(accounts[0], wallet);
        } catch {
          // non-fatal — will retry on first actual write
        }

        await fetchProfile(accounts[0]);
        return { account: accounts[0], provider: wallet };
      } catch (e) {
        console.error("[session] connect failed:", e);
        return null;
      }
    },
    [fetchProfile]
  );

  const connect = useCallback(async (): Promise<{ account: string; provider: InjectedProvider } | null> => {
    if (typeof window === "undefined" || !window.ethereum) {
      alert("Install an EVM wallet (MetaMask, Rabby, Coinbase…) to continue.");
      return null;
    }
    if (hasWalletChoice()) {
      return new Promise<{ account: string; provider: InjectedProvider } | null>((resolve) => {
        connectResolver.current = resolve;
        setPickerOpen(true);
      });
    }
    return adoptProvider(window.ethereum);
  }, [adoptProvider]);

  const disconnect = useCallback(() => {
    setAccount(null);
    setProvider(null);
    setProfile(null);
    setOnboardOpen(false);
    invalidateWriter();
  }, []);

  const reloadProfile = useCallback(async () => {
    if (account) await fetchProfile(account);
  }, [account, fetchProfile]);

  // Silent reconnect on first paint when the wallet already granted access.
  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !window.ethereum) {
        setBooting(false);
        return;
      }
      try {
        const accounts = (await window.ethereum.request({
          method: "eth_accounts",
        })) as string[];
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          setProvider(window.ethereum);

          // Eagerly initialise SDK writer for the cached provider.
          try {
            writer(accounts[0], window.ethereum);
          } catch {
            // non-fatal
          }

          await fetchProfile(accounts[0]);
        } else {
          setBooting(false);
        }
      } catch (e) {
        console.error("[session] silent reconnect failed:", e);
        setBooting(false);
      }
    })();
  }, [fetchProfile]);

  // Listen for account/chain changes in the injected wallet.
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eth = window.ethereum as any;

    const onAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAccount(null);
        setProvider(null);
        setProfile(null);
        invalidateWriter();
        return;
      }
      const newAddr = accounts[0];
      setAccount(newAddr);
      invalidateWriter();
      setProvider(window.ethereum ?? null);
      void fetchProfile(newAddr);
    };

    eth.on?.("accountsChanged", onAccountsChanged);
    return () => {
      eth.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, [fetchProfile]);

  const value = useMemo<SessionValue>(
    () => ({
      account,
      provider,
      profile,
      joined: profile !== null,
      booting,
      connect,
      disconnect,
      reloadProfile,
    }),
    [account, provider, profile, booting, connect, disconnect, reloadProfile]
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {pickerOpen && (
        <WalletModal
          onPick={async (w) => {
            setPickerOpen(false);
            const result = await adoptProvider(w);
            if (connectResolver.current) {
              connectResolver.current(result);
              connectResolver.current = null;
            }
          }}
          onClose={() => {
            setPickerOpen(false);
            if (connectResolver.current) {
              connectResolver.current(null);
              connectResolver.current = null;
            }
          }}
        />
      )}
      {onboardOpen && account && (
        <OnboardingDialog
          onDone={() => {
            setOnboardOpen(false);
            void fetchProfile(account);
          }}
          onClose={() => setOnboardOpen(false)}
        />
      )}
    </SessionContext.Provider>
  );
}
