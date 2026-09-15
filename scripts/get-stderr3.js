const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

async function main() {
  const account = createAccount("0x02547f4d74e86714c0870edfeca6e07c4818ebf58d6ed7c9aededdd866c29f1e");
  const client = createClient({ chain: studionet, account });

  const hashes = {
    take_side: "0x34f08ad6d8e68c9fe6f11c428c4fb5965f1e39e0f6d557cacdf279335c0e4cd3",
    cash_out: "0xdd45aff4cccb1123a444804017c6a02dd9278b458f81007d2ef37af2badc68e5",
    collect_fees: "0x2e54e53f392fb0a33cd1247e32773b2130019df939c09c0da1aa38214f9661fc",
  };

  for (const [name, hash] of Object.entries(hashes)) {
    console.log(`\n=== ${name} ===`);
    try {
      const tx = await client.getTransaction({ hash });
      const leader = Array.isArray(tx?.consensus_data?.leader_receipt)
        ? tx.consensus_data.leader_receipt[0] : tx?.consensus_data?.leader_receipt;
      console.log("STDERR:", leader?.genvm_result?.stderr);
    } catch (e) {
      console.log("Error:", e.message?.substring(0, 200));
    }
  }
}

main().catch(console.error);
