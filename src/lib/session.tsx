"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { type Address, formatEther, parseEther } from "viem";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { toast } from "sonner";

const CONTRACT_ADDRESS = "0xF1c2F3c96d33413D8ca8cFfDe0fe8cE6A3ae95e7";
const STUDIONET_CHAIN_ID_HEX = `0x${studionet.id.toString(16)}`;

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

function getEthereumProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as any).ethereum as Eip1193Provider | undefined;
}

/**
 * genlayer-js signs write transactions through the browser wallet, so the
 * wallet must be on Studionet before `eth_sendTransaction` is called.
 */
async function ensureWalletChain() {
  const provider = getEthereumProvider();
  if (!provider) return;

  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === STUDIONET_CHAIN_ID_HEX) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
    });
  } catch (switchError: any) {
    // 4902 = chain not added to the wallet yet
    if (switchError?.code !== 4902) throw switchError;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: STUDIONET_CHAIN_ID_HEX,
          chainName: studionet.name,
          nativeCurrency: studionet.nativeCurrency,
          rpcUrls: studionet.rpcUrls.default.http,
          blockExplorerUrls: [(studionet as any).blockExplorers?.default?.url].filter(
            Boolean
          ),
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
    });
  }
}

interface Session {
  address: Address | null;
  alias: string | null;
  connected: boolean;
  connecting: boolean;
  balance: string;
  ownerAddress: string | null;
  feeBalance: string;
  totalMarkets: number;
  totalTraders: number;
  totalWagers: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  join: (alias: string) => Promise<void>;
  openMarket: (params: {
    question: string;
    topic: string;
    sourceUrl: string;
    closesAt: number;
    minWager: string;
    maxWager: string;
  }) => Promise<void>;
  takeSide: (marketId: string, side: "yes" | "no", amount: string) => Promise<void>;
  settleMarket: (marketId: string) => Promise<void>;
  terminalVoid: (marketId: string) => Promise<void>;
  claimPayout: (marketId: string) => Promise<void>;
  reclaimStake: (marketId: string) => Promise<void>;
  collectFees: (amount: string) => Promise<void>;
  getMarket: (marketId: string) => Promise<any>;
  getTraderInfo: (address: string) => Promise<any>;
  getTraderPositions: (address: string) => Promise<any[]>;
  getTopCats: () => Promise<any[]>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [balance, setBalance] = useState("0");
  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [feeBalance, setFeeBalance] = useState("0");
  const [totalMarkets, setTotalMarkets] = useState(0);
  const [totalTraders, setTotalTraders] = useState(0);
  const [totalWagers, setTotalWagers] = useState("0");

  // Reads never need a wallet, so they keep working while disconnected.
  const readClient = useMemo(() => createClient({ chain: studionet }), []);

  // Writes must be signed by the connected wallet. The account address is
  // enough for genlayer-js/viem: the request is routed through the EIP-1193
  // provider below, which lets the wallet show its confirmation popup.
  const writeClient = useMemo(() => {
    if (!address) return null;
    return createClient({
      chain: studionet,
      account: address,
      provider: getEthereumProvider(),
    });
  }, [address]);

  const requireWriteClient = useCallback(() => {
    if (!address || !writeClient) {
      throw new Error("Connect your wallet first");
    }
    if (!getEthereumProvider()) {
      throw new Error("No browser wallet detected. Install a wallet to sign transactions.");
    }
    return writeClient;
  }, [address, writeClient]);

  useEffect(() => {
    const provider = getEthereumProvider();
    if (!provider?.on || !provider.removeListener) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (!accounts?.length) {
        setAddress(null);
        setAlias(null);
        setBalance("0");
      } else {
        setAddress(accounts[0] as Address);
        setAlias(null);
      }
    };

    provider.on("accountsChanged", handleAccountsChanged);
    return () => provider.removeListener?.("accountsChanged", handleAccountsChanged);
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const [markets, traders, wagers, owner, fees] = await Promise.all([
        readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_total_markets",
          args: [],
        }),
        readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_total_traders",
          args: [],
        }),
        readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_total_wagers",
          args: [],
        }),
        readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_owner",
          args: [],
        }),
        readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_fee_balance",
          args: [],
        }),
      ]);
      setTotalMarkets(Number(markets as string));
      setTotalTraders(Number(traders as string));
      setTotalWagers(formatEther(BigInt(wagers as string)));
      setOwnerAddress(String(owner as string));
      setFeeBalance(formatEther(BigInt(fees as string)));
    } catch (e) {
      console.error("Failed to refresh stats", e);
    }
  }, [readClient]);

  const connect = useCallback(async () => {
    const provider = getEthereumProvider();
    if (!provider) {
      toast.error("No browser wallet detected. Install MetaMask or another EVM wallet.");
      return;
    }

    setConnecting(true);
    try {
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[] | undefined;

      if (!accounts?.[0]) {
        toast.error("No wallet account was authorized.");
        return;
      }

      const addr = accounts[0] as Address;
      setAddress(addr);

      try {
        await ensureWalletChain();
      } catch {
        toast.error("Switch your wallet to GenLayer Studionet (Chain ID 61999) to trade.");
      }

      const info = await readClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_trader_info",
        args: [addr],
      });
      if (info !== "unknown trader") {
        const parsed = JSON.parse(info as string);
        setAlias(parsed.alias);
      }

      const bal = await provider.request({
        method: "eth_getBalance",
        params: [addr, "latest"],
      });
      setBalance(formatEther(BigInt(bal as string)));

      await refreshStats();
    } catch (e: any) {
      console.error("Connect failed", e);
      toast.error(e?.message || "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, [readClient, refreshStats]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setAlias(null);
    setBalance("0");
  }, []);

  const join = useCallback(
    async (newAlias: string) => {
      const client = requireWriteClient();
      await ensureWalletChain();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "join",
        args: [newAlias.trim()],
        value: BigInt(0),
      });
      await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
      setAlias(newAlias);
    },
    [requireWriteClient]
  );

  const openMarket = useCallback(
    async ({
      question,
      topic,
      sourceUrl,
      closesAt,
      minWager,
      maxWager,
    }: {
      question: string;
      topic: string;
      sourceUrl: string;
      closesAt: number;
      minWager: string;
      maxWager: string;
    }) => {
      const client = requireWriteClient();
      await ensureWalletChain();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "open_market",
        args: [
          question.trim(),
          topic,
          sourceUrl.trim(),
          BigInt(closesAt),
          parseEther(minWager || "0"),
          parseEther(maxWager || "0"),
        ],
        value: BigInt(0),
      });
      await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [requireWriteClient]
  );

  const takeSide = useCallback(
    async (marketId: string, side: "yes" | "no", amount: string) => {
      const client = requireWriteClient();
      await ensureWalletChain();
      const wei = parseEther(amount);
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "take_side",
        args: [BigInt(marketId), side],
        value: wei,
      });
      await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [requireWriteClient]
  );

  const settleMarket = useCallback(
    async (marketId: string) => {
      const client = requireWriteClient();
      await ensureWalletChain();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "settle_market",
        args: [marketId],
        value: BigInt(0),
      });
      await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [requireWriteClient]
  );

  const terminalVoid = useCallback(
    async (marketId: string) => {
      const client = requireWriteClient();
      await ensureWalletChain();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "terminal_void",
        args: [marketId],
        value: BigInt(0),
      });
      await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [requireWriteClient]
  );

  const claimPayout = useCallback(
    async (marketId: string) => {
      const client = requireWriteClient();
      await ensureWalletChain();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "claim_payout",
        args: [marketId],
        value: BigInt(0),
      });
      await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [requireWriteClient]
  );

  const reclaimStake = useCallback(
    async (marketId: string) => {
      const client = requireWriteClient();
      await ensureWalletChain();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "reclaim_stake",
        args: [marketId],
        value: BigInt(0),
      });
      await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [requireWriteClient]
  );

  const collectFees = useCallback(
    async (amount: string) => {
      const client = requireWriteClient();
      await ensureWalletChain();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "collect_fees",
        args: [parseEther(amount)],
        value: BigInt(0),
      });
      await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [requireWriteClient]
  );

  const getMarket = useCallback(
    async (marketId: string) => {
      const result = await readClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_market",
        args: [marketId],
      });
      return JSON.parse(result as string);
    },
    [readClient]
  );

  const getTraderInfo = useCallback(
    async (traderAddress: string) => {
      const result = await readClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_trader_info",
        args: [traderAddress],
      });
      if (result === "unknown trader") return null;
      return JSON.parse(result as string);
    },
    [readClient]
  );

  const getTraderPositions = useCallback(
    async (traderAddress: string) => {
      const result = await readClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_trader_positions",
        args: [traderAddress],
      });
      return JSON.parse(result as string);
    },
    [readClient]
  );

  const getTopCats = useCallback(async () => {
    const result = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_top_cats",
      args: [],
    });
    return JSON.parse(result as string);
  }, [readClient]);

  return (
    <SessionContext.Provider
      value={{
        address,
        alias,
        connected: !!address,
        connecting,
        balance,
        ownerAddress,
        feeBalance,
        totalMarkets,
        totalTraders,
        totalWagers,
        connect,
        disconnect,
        join,
        openMarket,
        takeSide,
        settleMarket,
        terminalVoid,
        claimPayout,
        reclaimStake,
        collectFees,
        getMarket,
        getTraderInfo,
        getTraderPositions,
        getTopCats,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
