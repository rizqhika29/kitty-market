const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

async function main() {
  const account = createAccount("0x02547f4d74e86714c0870edfeca6e07c4818ebf58d6ed7c9aededdd866c29f1e");
  const client = createClient({ chain: studionet, account });

  const hashes = [
    "0x839966a42f00a302ba46a15fc1f5b09d774fb25cfb090631f0248dbc4d6b1117",
    "0x3dc4d79fc0d6a8b3c7dbc08df37c0ed062c8e85ff9a2595b7f1283f573478763",
  ];

  for (const hash of hashes) {
    console.log(`\n=== ${hash.substring(0,20)}... ===`);
    try {
      const tx = await client.getTransaction({ hash });
      const leader = Array.isArray(tx?.consensus_data?.leader_receipt)
        ? tx.consensus_data.leader_receipt[0] : tx?.consensus_data?.leader_receipt;
      console.log(leader?.genvm_result?.stderr);
    } catch (e) {
      console.log("Error:", e.message?.substring(0, 200));
    }
  }
}

main().catch(console.error);
