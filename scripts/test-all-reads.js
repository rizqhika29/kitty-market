const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0x47942ab470b0e767f7bb0377750b3e04578c818dc85986da4f8de82ad3bdabd5";
const OLD_CONTRACT = "0x13C2bc0722780691D498A58391057eA70b37ccfF";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  console.log("=== Testing all READ methods on old contract ===\n");
  console.log("Contract:", OLD_CONTRACT);
  console.log("Owner of old contract:", "0x65137a8f93fee5dfa5b6cf9bf055bb5cd353aaf0\n");

  // 1. get_owner
  try {
    const owner = await client.readContract({ address: OLD_CONTRACT, functionName: "get_owner", args: [] });
    console.log("get_owner:", owner);
  } catch (e) {
    console.log("get_owner FAILED:", e.shortMessage?.substring(0, 100));
  }

  // 2. get_total_markets
  try {
    const total = await client.readContract({ address: OLD_CONTRACT, functionName: "get_total_markets", args: [] });
    console.log("get_total_markets:", total.toString());
  } catch (e) {
    console.log("get_total_markets FAILED:", e.shortMessage?.substring(0, 100));
  }

  // 3. get_total_wagers
  try {
    const wagers = await client.readContract({ address: OLD_CONTRACT, functionName: "get_total_wagers", args: [] });
    console.log("get_total_wagers:", wagers.toString());
  } catch (e) {
    console.log("get_total_wagers FAILED:", e.shortMessage?.substring(0, 100));
  }

  // 4. get_total_traders
  try {
    const traders = await client.readContract({ address: OLD_CONTRACT, functionName: "get_total_traders", args: [] });
    console.log("get_total_traders:", traders.toString());
  } catch (e) {
    console.log("get_total_traders FAILED:", e.shortMessage?.substring(0, 100));
  }

  // 5. get_fee_balance
  try {
    const fee = await client.readContract({ address: OLD_CONTRACT, functionName: "get_fee_balance", args: [] });
    console.log("get_fee_balance:", fee.toString());
  } catch (e) {
    console.log("get_fee_balance FAILED:", e.shortMessage?.substring(0, 100));
  }

  // 6. get_market(0) - if any markets exist
  try {
    const total = await client.readContract({ address: OLD_CONTRACT, functionName: "get_total_markets", args: [] });
    if (total > BigInt(0)) {
      const market = await client.readContract({ address: OLD_CONTRACT, functionName: "get_market", args: [BigInt(0)] });
      console.log("get_market(0):", market);
    } else {
      console.log("get_market(0): SKIPPED (no markets)");
    }
  } catch (e) {
    console.log("get_market(0) FAILED:", e.shortMessage?.substring(0, 100));
  }

  // 7. get_top_cats
  try {
    const topCats = await client.readContract({ address: OLD_CONTRACT, functionName: "get_top_cats", args: [] });
    console.log("get_top_cats:", topCats);
  } catch (e) {
    console.log("get_top_cats FAILED:", e.shortMessage?.substring(0, 100));
  }

  // 8. get_trader_info (with a known address)
  try {
    const info = await client.readContract({ address: OLD_CONTRACT, functionName: "get_trader_info", args: ["0x65137a8f93fee5dfa5b6cf9bf055bb5cd353aaf0"] });
    console.log("get_trader_info:", info);
  } catch (e) {
    console.log("get_trader_info FAILED:", e.shortMessage?.substring(0, 100));
  }

  // 9. get_trader_positions
  try {
    const positions = await client.readContract({ address: OLD_CONTRACT, functionName: "get_trader_positions", args: ["0x65137a8f93fee5dfa5b6cf9bf055bb5cd353aaf0"] });
    console.log("get_trader_positions:", positions);
  } catch (e) {
    console.log("get_trader_positions FAILED:", e.shortMessage?.substring(0, 100));
  }

  console.log("\n=== All READ methods tested ===");
}

main().catch(console.error);
