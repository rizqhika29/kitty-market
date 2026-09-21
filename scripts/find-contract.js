const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PK = "0xc6eb968738a5ce315b1b290d59a5ea74a17bedbb6ee23b32300f3940e6eac95b";
const TX_HASH = "0xc34e9cf401a8389018cb9750089bfaa8a162d392850ee2218d5c80a5efe5d277";

async function main() {
  const account = createAccount(PK);
  const client = createClient({ chain: studionet, account });

  const tx = await client.getTransaction({ hash: TX_HASH });
  console.log("Transaction keys:", Object.keys(tx));
  console.log("statusName:", tx.statusName);
  console.log("resultName:", tx.resultName);
  console.log("txExecutionResultName:", tx.txExecutionResultName);
  
  if (tx.data) {
    console.log("tx.data:", JSON.stringify(tx.data)?.substring(0, 500));
  }
  if (tx.recipient) {
    console.log("tx.recipient:", tx.recipient);
  }
  
  if (tx.consensus_data?.leader_receipt) {
    const lr = Array.isArray(tx.consensus_data.leader_receipt) 
      ? tx.consensus_data.leader_receipt[0] 
      : tx.consensus_data.leader_receipt;
    if (lr) {
      console.log("\nLeader receipt keys:", Object.keys(lr));
      console.log("execution_result:", lr.execution_result);
      if (lr.contract_address) console.log("contract_address:", lr.contract_address);
      if (lr.created_contract_address) console.log("created_contract_address:", lr.created_contract_address);
      if (lr.output) console.log("output:", JSON.stringify(lr.output)?.substring(0, 300));
      if (lr.genvm_result) {
        console.log("genvm_result:", JSON.stringify(lr.genvm_result)?.substring(0, 500));
      }
    }
  }

  // Also try getTransactionReceipt
  try {
    const receipt = await client.getTransactionReceipt({ hash: TX_HASH });
    console.log("\nReceipt:", JSON.stringify(receipt)?.substring(0, 1000));
  } catch (e) {
    console.log("\nReceipt error:", e.shortMessage?.substring(0, 200));
  }
}

main().catch(console.error);
