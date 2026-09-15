const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

async function main() {
  const pk = generatePrivateKey();
  const account = createAccount(pk);
  console.log("Fresh account:", account.address);
  console.log("Private key:", pk);

  const client = createClient({ chain: studionet, account });

  // Fund
  console.log("\nFunding account...");
  try {
    await client.request({ method: "sim_fundAccount", params: [account.address, 1000] });
    console.log("Funded 1000 GEN");
  } catch (e) {
    console.log("Fund error:", e.message);
  }

  // Deploy
  const contractCode = fs.readFileSync(path.join(__dirname, "..", "contracts", "kitty_market.py"), "utf-8");
  console.log("\nDeploying contract...");
  const deployHash = await client.deployContract({
    code: contractCode,
    args: [],
    value: BigInt(0),
    leaderOnly: true,
  });
  console.log("Deploy hash:", deployHash);

  // Wait for receipt
  console.log("Waiting for receipt...");
  const receipt = await client.waitForTransactionReceipt({
    hash: deployHash,
    status: "FINALIZED",
    fullTransaction: true,
  });

  console.log("\n=== Receipt ===");
  console.log("Status:", receipt.statusName);
  console.log("Execution result:", receipt.txExecutionResultName);
  console.log("To:", receipt.to_address || receipt.recipient);
  console.log("Num rounds:", receipt.numOfRounds);

  // Check consensus
  if (receipt.last_round) {
    console.log("Votes:", receipt.last_round.validator_votes_name);
    console.log("Round result:", receipt.last_round.result);
  }

  const newAddr = receipt.to_address || receipt.recipient;
  if (!newAddr) {
    console.error("No contract address in receipt!");
    process.exit(1);
  }

  // Wait for state to propagate
  console.log("\nWaiting 90s for state propagation...");
  await new Promise(r => setTimeout(r, 90000));

  // Try read
  console.log("Attempting readContract...");
  for (let i = 0; i < 5; i++) {
    try {
      const owner = await client.readContract({
        address: newAddr,
        functionName: "get_owner",
        args: [],
      });
      console.log("SUCCESS! Owner:", owner);

      // Save
      fs.writeFileSync(
        path.join(__dirname, "contract-address.json"),
        JSON.stringify({ address: newAddr, privateKey: pk }, null, 2)
      );
      console.log("Saved to contract-address.json");
      return;
    } catch (e) {
      console.log(`  Attempt ${i+1} failed: ${e.shortMessage?.substring(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 15000));
  }
  console.log("Could not read contract after all attempts");
}

main().catch(console.error);
