const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const PRIVATE_KEY = "0x47942ab470b0e767f7bb0377750b3e04578c818dc85986da4f8de82ad3bdabd5";

async function main() {
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({ chain: studionet, account });

  // Get old contract deploy tx details
  const oldTx = "0xa83989c15c2bf164d6cd455610709c312bca712a10b1554e655005a33c908ee1";
  console.log("=== Old contract deploy tx ===");
  const receipt = await client.waitForTransactionReceipt({
    hash: oldTx,
    status: "FINALIZED",
    fullTransaction: true,
  });
  console.log("Status:", receipt.statusName);
  console.log("Execution:", receipt.txExecutionResultName);
  console.log("To:", receipt.to_address || receipt.recipient);
  console.log("Num rounds:", receipt.numOfRounds);
  if (receipt.last_round) {
    console.log("Votes:", receipt.last_round.validator_votes_name);
    console.log("Round result:", receipt.last_round.result);
  }
  // Full receipt for inspection
  console.log("\nFull receipt keys:", Object.keys(receipt));
  console.log("Contract address:", receipt.contract_address);
  console.log("result_name:", receipt.result_name);

  // Try getTransaction
  try {
    const tx = await client.getTransaction({ hash: oldTx });
    console.log("\n=== Transaction details ===");
    console.log("Keys:", Object.keys(tx));
    console.log("Type:", tx.type);
    console.log("From:", tx.from);
    console.log("To:", tx.to);
    console.log("Input length:", tx.input?.length);
    console.log("Input first 200 chars:", tx.input?.substring(0, 200));
    console.log("Value:", tx.value?.toString());
    console.log("ChainId:", tx.chainId);
  } catch (e) {
    console.log("getTransaction error:", e.shortMessage?.substring(0, 200));
  }
}

main().catch(console.error);
