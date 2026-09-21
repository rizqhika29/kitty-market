const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const PK = "0xc6eb968738a5ce315b1b290d59a5ea74a17bedbb6ee23b32300f3940e6eac95b";
const CODE_PATH = path.join(__dirname, "..", "contracts", "kitty_market.py");

async function main() {
  const account = createAccount(PK);
  const client = createClient({ chain: studionet, account });

  const code = fs.readFileSync(CODE_PATH, "utf-8");
  const codeBytes = new TextEncoder().encode(code);

  console.log("Deploying kitty_market...");

  const ownerHex = account.address;

  const txHash = await client.deployContract({
    code: codeBytes,
    args: [ownerHex],
    value: BigInt(0),
  });

  console.log("TX hash:", txHash);

  let contractAddress = null;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const tx = await client.getTransaction({ hash: txHash });
      if (tx && tx.statusName === "FINALIZED") {
        contractAddress = tx.data?.contract_address || tx.recipient;
        const leader = Array.isArray(tx.consensus_data?.leader_receipt)
          ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
        if (leader?.execution_result === "ERROR") {
          console.log("DEPLOY FAILED:");
          console.log(leader?.genvm_result?.stderr?.substring(0, 500));
          process.exit(1);
        }
        break;
      }
    } catch (e) {}
    if (i % 10 === 0) console.log(`Waiting... (${i * 3}s)`);
  }

  console.log("\n=== Deployed ===");
  console.log("Address:", contractAddress);
  console.log("Explorer:", `https://explorer-studio.genlayer.com/contracts/${contractAddress}`);

  // Update contract-address.json
  const configPath = path.join(__dirname, "contract-address.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  config.address = contractAddress;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log("\nUpdated contract-address.json");

  // Quick verify
  console.log("\n=== Verifying ===");
  try {
    const owner = await client.readContract({ address: contractAddress, functionName: "get_owner", args: [] });
    console.log("get_owner:", owner);
  } catch (e) {
    console.log("get_owner error:", e.shortMessage?.substring(0, 100));
  }
}

main().catch(console.error);
