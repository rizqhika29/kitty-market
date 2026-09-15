const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY = "0x47942ab470b0e767f7bb0377750b3e04578c818dc85986da4f8de82ad3bdabd5";
const DEPLOY_HASH = "0xe09c531f32eebc5f87413e083c911d0c94b8a73b07d349a0ef988780bfc7d492";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  console.log("Polling tx status for:", DEPLOY_HASH);

  for (let i = 0; i < 60; i++) {
    try {
      const tx = await client.getTransaction({ hash: DEPLOY_HASH });
      console.log(`[${i}] status: ${tx.statusName || tx.status}, result: ${tx.txExecutionResultName || "N/A"}`);

      if (tx.statusName === "FINALIZED" || tx.status === 7) {
        console.log("\nTransaction finalized!");
        const contractAddr = tx.to_address || tx.recipient;
        console.log("Contract address:", contractAddr);

        // Save
        fs.writeFileSync(
          path.join(__dirname, "contract-address.json"),
          JSON.stringify({ address: contractAddr }, null, 2)
        );

        // Try to read
        if (contractAddr) {
          try {
            const owner = await client.readContract({
              address: contractAddr,
              functionName: "get_owner",
              args: [],
            });
            console.log("Owner:", owner);
            console.log("Contract is live!");
          } catch (e) {
            console.log("Read error:", e.message);
          }
        }
        return;
      }
    } catch (e) {
      console.log(`[${i}] Error:`, e.message?.substring(0, 100));
    }
    await new Promise(r => setTimeout(r, 15000)); // 15s between polls
  }
  console.log("Timed out waiting for finalization");
}

main().catch(console.error);
