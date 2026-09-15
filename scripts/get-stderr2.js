const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

async function main() {
  const account = createAccount("0xe85d76967df46f85c4ad6397405c3ebd22c03bb86782c0c712f0edab5fc90f06");
  const client = createClient({ chain: studionet, account });

  const joinHash = "0x8fa079368df79ffb7098e195b6cdcd759629d7c5278764f4d90d07427fb5b2af";
  const tx = await client.getTransaction({ hash: joinHash });
  const leader = Array.isArray(tx?.consensus_data?.leader_receipt)
    ? tx.consensus_data.leader_receipt[0] : tx?.consensus_data?.leader_receipt;
  
  console.log("=== FULL STDERR ===");
  console.log(leader?.genvm_result?.stderr);
  console.log("\n=== FULL STDOUT ===");
  console.log(leader?.genvm_result?.stdout);
}

main().catch(console.error);
