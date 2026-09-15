const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const CONTRACT = "0xB4941E7F849C112aCe354E5eaD956E08D95744Bc";
const PK = "0x02547f4d74e86714c0870edfeca6e07c4818ebf58d6ed7c9aededdd866c29f1e";

async function main() {
  const account = createAccount(PK);
  const client = createClient({ chain: studionet, account });

  // Quick verify the contract still works
  console.log("=== Verifying contract still works ===");
  try {
    const owner = await client.readContract({ address: CONTRACT, functionName: "get_owner", args: [] });
    console.log("get_owner:", owner);
  } catch (e) {
    console.log("get_owner FAILED:", e.shortMessage?.substring(0, 200));
  }

  try {
    const total = await client.readContract({ address: CONTRACT, functionName: "get_total_markets", args: [] });
    console.log("get_total_markets:", total.toString());
  } catch (e) {
    console.log("get_total_markets FAILED:", e.shortMessage?.substring(0, 200));
  }

  try {
    const traders = await client.readContract({ address: CONTRACT, functionName: "get_total_traders", args: [] });
    console.log("get_total_traders:", traders.toString());
  } catch (e) {
    console.log("get_total_traders FAILED:", e.shortMessage?.substring(0, 200));
  }

  try {
    const market = await client.readContract({ address: CONTRACT, functionName: "get_market", args: [0n] });
    console.log("get_market(0):", market);
  } catch (e) {
    console.log("get_market(0) FAILED:", e.shortMessage?.substring(0, 200));
  }

  try {
    const topCats = await client.readContract({ address: CONTRACT, functionName: "get_top_cats", args: [] });
    console.log("get_top_cats:", topCats);
  } catch (e) {
    console.log("get_top_cats FAILED:", e.shortMessage?.substring(0, 200));
  }

  // List all tx hashes for this contract
  console.log("\n=== Explorer URLs ===");
  const txHashes = [
    "0x72d86a73c252b009b18a7c392afd5772f8b06488534cfa3633b8b8b3b65c71f9", // join owner
    "0x4c5d78456c28ab8dd86a9d79da6a562f3d2fc8ceb7be81f0d2af53cd3dccd54b", // join creator
    "0xebf86d630fab68a375216d396b480b5aac3f29acfea858aa406595baf727e89a", // open_market
    "0xffaff4c0322ccc9efe95ab16d7b01cff57709cda8e68812481d22ee22671c633", // take_side
    "0xeb54e439e65a0cdec37ee47c28df198c5fae08ac2440c529d82e58a691a03973", // cash_out
    "0x303c89c2fa3421ccdc4e812cb37595898e494a6870e5242cd0600885b8ff12be", // collect_fees (expected fail)
  ];

  for (const h of txHashes) {
    try {
      const tx = await client.getTransaction({ hash: h });
      const leader = Array.isArray(tx?.consensus_data?.leader_receipt)
        ? tx.consensus_data.leader_receipt[0] : tx?.consensus_data?.leader_receipt;
      const result = leader?.execution_result || "unknown";
      const stderr = leader?.genvm_result?.stderr;
      console.log(`${h.substring(0,20)}... → ${result}${stderr ? ' ❌' : ''}`);
      if (stderr) console.log(`  stderr: ${stderr.substring(0, 150)}`);
    } catch (e) {
      console.log(`${h.substring(0,20)}... → Error: ${e.shortMessage?.substring(0, 80)}`);
    }
  }
}

main().catch(console.error);
