const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const CONTRACT = "0xB4941E7F849C112aCe354E5eaD956E08D95744Bc";
const PK = "0x02547f4d74e86714c0870edfeca6e07c4818ebf58d6ed7c9aededdd866c29f1e";

async function main() {
  const account = createAccount(PK);
  const client = createClient({ chain: studionet, account });

  // Get recent transactions for this contract
  // Try to get the contract schema to verify it's valid
  console.log("=== Contract Schema ===");
  try {
    const schema = await client.getContractSchema({ address: CONTRACT });
    console.log(JSON.stringify(schema, null, 2)?.substring(0, 2000));
  } catch (e) {
    console.log("Schema error:", e.shortMessage?.substring(0, 200));
  }

  // Check contract code
  console.log("\n=== Contract Code ===");
  try {
    const code = await client.getContractCode({ address: CONTRACT });
    console.log(code?.substring(0, 500));
  } catch (e) {
    console.log("Code error:", e.shortMessage?.substring(0, 200));
  }

  // Check all validators votes for the latest tx
  console.log("\n=== Collect fees tx details ===");
  const collectHash = "0x303c89c2fa3421ccdc4e812cb37595898e494a6870e5242cd0600885b8ff12be";
  try {
    const tx = await client.getTransaction({ hash: collectHash });
    console.log("Status:", tx.statusName);
    console.log("Result:", tx.resultName);
    console.log("Execution:", tx.txExecutionResultName);
    
    if (tx.consensus_data?.validators) {
      for (let i = 0; i < tx.consensus_data.validators.length; i++) {
        const v = tx.consensus_data.validators[i];
        console.log(`\nValidator ${i}:`);
        console.log(`  vote: ${v.vote}`);
        console.log(`  execution_result: ${v.execution_result}`);
        if (v.genvm_result?.stderr) console.log(`  stderr: ${v.genvm_result.stderr.substring(0, 200)}`);
      }
    }
  } catch (e) {
    console.log("Error:", e.message?.substring(0, 200));
  }
}

main().catch(console.error);
