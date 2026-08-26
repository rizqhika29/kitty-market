import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

/** Address of the deployed KittyMarket contract. */
export function marketContract(): string {
  return process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
}

export const NETWORK = {
  chainIdHex: "0xF22F", // 61999
  chainId: 61999,
  label: "Studionet",
  rpc: "https://studio.genlayer.com/api",
  symbol: "GEN",
  explorer: "https://explorer-studio.genlayer.com",
};

type GlClient = ReturnType<typeof createClient>;
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type AnyProvider = { request: (req: any) => Promise<unknown> };

let readClient: GlClient | null = null;

/**
 * Force legacy type-0 transactions with zero gas price — what the
 * GenLayer VM expects from injected EVM wallets.
 */
function tameProvider(provider: AnyProvider): AnyProvider {
  const flagged = provider as AnyProvider & { __kittyTamed?: boolean };
  if (flagged.__kittyTamed) return provider;

  const upstream = provider.request.bind(provider);
  provider.request = async (rawReq: unknown) => {
    const req = rawReq as { method?: string; params?: unknown[] };
    if (req.method === "eth_sendTransaction" && Array.isArray(req.params) && req.params[0]) {
      const tx = { ...(req.params[0] as Record<string, unknown>) };
      tx.type = "0x0";
      tx.gasPrice = "0x0";
      delete tx.maxFeePerGas;
      delete tx.maxPriorityFeePerGas;
      if (!tx.gas) tx.gas = "0x100000";
      return upstream({ ...req, params: [tx] });
    }
    return upstream(rawReq);
  };

  flagged.__kittyTamed = true;
  return provider;
}

/** Read-only client (cached). */
export function reader(): GlClient {
  if (!readClient) {
    readClient = createClient({ chain: studionet });
  }
  return readClient;
}

/** Client bound to a connected account for write calls. */
export function writer(address: string, provider?: AnyProvider | null): GlClient {
  return createClient({
    chain: studionet,
    account: address as `0x${string}`,
    ...(provider ? { provider: tameProvider(provider) } : {}),
  });
}

/** Format wei -> GEN string. */
export function toGen(wei: string | bigint, decimals = 2): string {
  const n = typeof wei === "bigint" ? Number(wei) : parseInt(wei || "0");
  return (n / 10 ** 18).toFixed(decimals);
}

/** GEN -> wei bigint. */
export function toWei(gen: string): bigint {
  return BigInt(Math.floor(parseFloat(gen) * 10 ** 18));
}

/** Shorten a hex address for display. */
export function short(addr: string, head = 6, tail = 4): string {
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
