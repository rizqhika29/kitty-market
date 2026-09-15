const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");

const PRIVATE_KEY = "0x47942ab470b0e767f7bb0377750b3e04578c818dc85986da4f8de82ad3bdabd5";
const CONTRACT = "0xEbd354C745f3d6a155F9C99b120135d8Ecff3F0B";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  console.log("Contract:", CONTRACT);
  console.log("Waiting 30s for propagation...\n");
  await new Promise(r => setTimeout(r, 30000));

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      console.log(`[${attempt + 1}] Trying readContract...`);
      const owner = await client.readContract({
        address: CONTRACT,
        functionName: "get_owner",
        args: [],
      });
      console.log("SUCCESS! Owner:", owner);
      return;
    } catch (e) {
      console.log(`  Error: ${e.shortMessage || e.message?.substring(0, 100)}`);
    }
    await new Promise(r => setTimeout(r, 15000));
  }
  console.log("Failed to read contract after all attempts");
}

main().catch(console.error);
