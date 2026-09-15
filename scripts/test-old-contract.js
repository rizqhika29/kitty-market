const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0x47942ab470b0e767f7bb0377750b3e04578c818dc85986da4f8de82ad3bdabd5";
const OLD_CONTRACT = "0x13C2bc0722780691D498A58391057eA70b37ccfF";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Test old contract
  console.log("=== Testing old contract from frontend ===");
  console.log("Address:", OLD_CONTRACT);
  try {
    const owner = await client.readContract({
      address: OLD_CONTRACT,
      functionName: "get_owner",
      args: [],
    });
    console.log("Old contract WORKS! Owner:", owner);
  } catch (e) {
    console.log("Old contract error:", e.shortMessage || e.message?.substring(0, 200));
  }

  // Test new contracts with different stateStatus
  const newContracts = [
    "0xEbd354C745f3d6a155F9C99b120135d8Ecff3F0B",
    "0x175D583Dc1D404A62C126E103D626c6AeF2041f0",
  ];

  for (const addr of newContracts) {
    console.log("\n=== Testing", addr, "===");
    for (const status of ["latest-final", "latest-nonfinal"]) {
      try {
        const owner = await client.readContract({
          address: addr,
          functionName: "get_owner",
          args: [],
          transactionHashVariant: status,
        });
        console.log(`  ${status}: SUCCESS - Owner:`, owner);
      } catch (e) {
        console.log(`  ${status}: ${e.shortMessage || e.message?.substring(0, 100)}`);
      }
    }
  }
}

main().catch(console.error);
