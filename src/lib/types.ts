export interface Market {
  id: string;
  question: string;
  topic: string;
  source_url: string;
  closes_at: string;
  host: string;
  min_wager: string;
  max_wager: string;
  settled: boolean;
  phase: string;
  label: string;
  outcome: string;
  verdict_note: string;
  yes_pool: string;
  no_pool: string;
  pool: string;
}

export interface Position {
  id: string;
  market_id: string;
  size: string;
  side: "yes" | "no";
  closed: boolean;
}

export const TOPICS = [
  "crypto",
  "sports",
  "politics",
  "entertainment",
  "tech",
  "science",
  "other",
] as const;

export function weiToInt(v: string): number {
  try {
    return parseInt(v || "0");
  } catch {
    return 0;
  }
}

export function splitPools(m: Market): { yesPct: number; total: number } {
  const yes = weiToInt(m.yes_pool);
  const no = weiToInt(m.no_pool);
  const total = yes + no;
  return { yesPct: total > 0 ? (yes / total) * 100 : 50, total };
}

export function isExpired(market: Market): boolean {
  return Date.now() / 1000 > parseInt(market.closes_at || "0");
}

export function formatClose(ts: string, withTime = false): string {
  const d = new Date(parseInt(ts) * 1000);
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}
