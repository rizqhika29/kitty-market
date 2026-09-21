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

const CONTRACT_ADDRESS = "0x79e4B28A91277841aC8a3e1Da9204feb564081EF";

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
  cashOut: (amount: string) => Promise<void>;
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

  const client = useMemo(
    () => createClient({ chain: studionet }),
    []
  );

  const refreshStats = useCallback(async () => {
    try {
      const [markets, traders, wagers, owner, fees] = await Promise.all([
        client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_total_markets",
          args: [],
        }),
        client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_total_traders",
          args: [],
        }),
        client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_total_wagers",
          args: [],
        }),
        client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_owner",
          args: [],
        }),
        client.readContract({
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
  }, [client]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const accounts = await (window as any).ethereum?.request({
        method: "eth_requestAccounts",
      });
      if (accounts?.[0]) {
        const addr = accounts[0] as Address;
        setAddress(addr);

        const info = await client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_trader_info",
          args: [addr],
        });
        if (info !== "unknown trader") {
          const parsed = JSON.parse(info as string);
          setAlias(parsed.alias);
        }

        const bal = await (window as any).ethereum?.request({
          method: "eth_getBalance",
          params: [addr, "latest"],
        });
        setBalance(formatEther(BigInt(bal)));

        await refreshStats();
      }
    } catch (e) {
      console.error("Connect failed", e);
    } finally {
      setConnecting(false);
    }
  }, [client, refreshStats]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setAlias(null);
    setBalance("0");
  }, []);

  const join = useCallback(
    async (newAlias: string) => {
      if (!address) throw new Error("Not connected");
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "join",
        args: [newAlias.trim()],
        value: BigInt(0),
      });
      await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
      setAlias(newAlias);
    },
    [client, address]
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
      if (!address) throw new Error("Not connected");
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
      await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [client, address]
  );

  const takeSide = useCallback(
    async (marketId: string, side: "yes" | "no", amount: string) => {
      if (!address) throw new Error("Not connected");
      const wei = parseEther(amount);
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "take_side",
        args: [BigInt(marketId), side],
        value: wei,
      });
      await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [client, address]
  );

  const settleMarket = useCallback(
    async (marketId: string) => {
      if (!address) throw new Error("Not connected");
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "settle_market",
        args: [marketId],
        value: BigInt(0),
      });
      await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [client, address]
  );

  const terminalVoid = useCallback(
    async (marketId: string) => {
      if (!address) throw new Error("Not connected");
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "terminal_void",
        args: [marketId],
        value: BigInt(0),
      });
      await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [client, address]
  );

  const claimPayout = useCallback(
    async (marketId: string) => {
      if (!address) throw new Error("Not connected");
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "claim_payout",
        args: [marketId],
        value: BigInt(0),
      });
      await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [client, address]
  );

  const reclaimStake = useCallback(
    async (marketId: string) => {
      if (!address) throw new Error("Not connected");
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "reclaim_stake",
        args: [marketId],
        value: BigInt(0),
      });
      await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [client, address]
  );

  const cashOut = useCallback(
    async (amount: string) => {
      if (!address) throw new Error("Not connected");
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "cash_out",
        args: [parseEther(amount)],
        value: BigInt(0),
      });
      await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [client, address]
  );

  const collectFees = useCallback(
    async (amount: string) => {
      if (!address) throw new Error("Not connected");
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "collect_fees",
        args: [parseEther(amount)],
        value: BigInt(0),
      });
      await client.waitForTransactionReceipt({ hash, status: "FINALIZED" as any });
    },
    [client, address]
  );

  const getMarket = useCallback(
    async (marketId: string) => {
      const result = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_market",
        args: [marketId],
      });
      return JSON.parse(result as string);
    },
    [client]
  );

  const getTraderInfo = useCallback(
    async (traderAddress: string) => {
      const result = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_trader_info",
        args: [traderAddress],
      });
      if (result === "unknown trader") return null;
      return JSON.parse(result as string);
    },
    [client]
  );

  const getTraderPositions = useCallback(
    async (traderAddress: string) => {
      const result = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_trader_positions",
        args: [traderAddress],
      });
      return JSON.parse(result as string);
    },
    [client]
  );

  const getTopCats = useCallback(async () => {
    const result = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_top_cats",
      args: [],
    });
    return JSON.parse(result as string);
  }, [client]);

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
        cashOut,
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
