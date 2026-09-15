const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

async function main() {
  const account = createAccount("0xe85d76967df46f85c4ad6397405c3ebd22c03bb86782c0c712f0edab5fc90f06");
  const client = createClient({ chain: studionet, account });

  // The kitty_market deploy
  const deployHash = "0x54c38d5876cc7085f0a6dd9ec1939bf5f220d3eb44a5abc5911af6130e24e5b9";

  console.log("=== Full kitty_market stderr ===");
  const tx = await client.getTransaction({ hash: deployHash });
  const leader = Array.isArray(tx.consensus_data?.leader_receipt)
    ? tx.consensus_data.leader_receipt[0]
    : tx.consensus_data?.leader_receipt;
  
  if (leader?.genvm_result?.stderr) {
    console.log(leader.genvm_result.stderr);
  }

  // Also check all validators
  if (tx.consensus_data?.validators) {
    for (let i = 0; i < tx.consensus_data.validators.length; i++) {
      const v = tx.consensus_data.validators[i];
      if (v.genvm_result?.stderr) {
        console.log(`\n=== Validator ${i} stderr ===`);
        console.log(v.genvm_result.stderr);
      }
    }
  }

  // Also check simplified version
  console.log("\n\n=== Full simplified kitty_market stderr ===");
  const hash2 = "0xfeccc7d5b7838fff467e3bef3a44ee2572ccb0665c64adccf5546484538d114a";
  const tx2 = await client.getTransaction({ hash: hash2 });
  const leader2 = Array.isArray(tx2.consensus_data?.leader_receipt)
    ? tx2.consensus_data.leader_receipt[0]
    : tx2.consensus_data?.leader_receipt;
  
  if (leader2?.genvm_result?.stderr) {
    console.log(leader2.genvm_result.stderr);
  }
}

main().catch(console.error);
