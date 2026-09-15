const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PK = "0xeb844ebb5c069eb1ef68243563db1406bc83cd6c90af7fc6478cb013348ca5f5";

async function main() {
  const account = createAccount(PK);
  const client = createClient({ chain: studionet, account });

  // Get full stderr for join tx
  const joinHash = "0x98d298344aa68e0cb39edaf5fc70499fe506ab4ff0d1a449898137b1fdc221b3";
  const tx = await client.getTransaction({ hash: joinHash });
  
  const leader = Array.isArray(tx?.consensus_data?.leader_receipt)
    ? tx.consensus_data.leader_receipt[0] : tx?.consensus_data?.leader_receipt;
  
  console.log("=== JOIN FULL STDERR ===");
  console.log(leader?.genvm_result?.stderr);
  
  // Check all validators for any useful info
  if (tx?.consensus_data?.validators) {
    for (let i = 0; i < tx.consensus_data.validators.length; i++) {
      const v = tx.consensus_data.validators[i];
      if (v.genvm_result?.stdout) console.log(`\nValidator ${i} stdout:`, v.genvm_result.stdout);
      if (v.genvm_result?.stderr) console.log(`\nValidator ${i} stderr (full):`, v.genvm_result.stderr);
    }
  }
}

main().catch(console.error);
