const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0x47942ab470b0e767f7bb0377750b3e04578c818dc85986da4f8de82ad3bdabd5";
const OLD_CONTRACT = "0x13C2bc0722780691D498A58391057eA70b37ccfF";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Check old contract schema
  console.log("=== Old contract schema ===");
  const schema = await client.getContractSchema({ address: OLD_CONTRACT });
  console.log(JSON.stringify(schema, (k, v) => typeof v === "bigint" ? v.toString() : v, 2));

  // Read old contract state
  console.log("\n=== Old contract total_markets ===");
  const total = await client.readContract({
    address: OLD_CONTRACT,
    functionName: "get_total_markets",
    args: [],
  });
  console.log("Total markets:", total.toString());
}

main().catch(console.error);
