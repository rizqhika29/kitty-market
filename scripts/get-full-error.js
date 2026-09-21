const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PK = "0xc6eb968738a5ce315b1b290d59a5ea74a17bedbb6ee23b32300f3940e6eac95b";
const TX_HASH = "0xc34e9cf401a8389018cb9750089bfaa8a162d392850ee2218d5c80a5efe5d277";

async function main() {
  const account = createAccount(PK);
  const client = createClient({ chain: studionet, account });

  const tx = await client.getTransaction({ hash: TX_HASH });
  const lr = Array.isArray(tx.consensus_data?.leader_receipt)
    ? tx.consensus_data.leader_receipt[0]
    : tx.consensus_data?.leader_receipt;
  
  if (lr?.genvm_result?.stderr) {
    console.log("=== FULL STDERR ===");
    console.log(lr.genvm_result.stderr);
  }
  
  // Check all validators
  if (tx.consensus_data?.validators) {
    for (let i = 0; i < tx.consensus_data.validators.length; i++) {
      const v = tx.consensus_data.validators[i];
      console.log(`\nValidator ${i}: vote=${v.vote}, result=${v.execution_result}`);
      if (v.genvm_result?.stderr) {
        console.log(`  stderr: ${v.genvm_result.stderr}`);
      }
    }
  }

  // Also check triggered transactions
  if (tx.triggered_transactions?.length) {
    console.log("\n=== Triggered TXs ===");
    for (const t of tx.triggered_transactions) {
      console.log(JSON.stringify(t)?.substring(0, 500));
    }
  }
}

main().catch(console.error);
