const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const B = (x) => (Number(x) / 1e18).toFixed(6);

async function main() {
  const A = createAccount(generatePrivateKey());
  const Bacc = createAccount(generatePrivateKey());
  const cA = createClient({ chain: studionet, account: A });
  const cB = createClient({ chain: studionet, account: Bacc });

  const bal = async (a) => BigInt(await cA.request({ method: "eth_getBalance", params: [a, "latest"] }));

  console.log("A", A.address, "B", Bacc.address);

  // fund A with ~10 GL in wei (number, not BigInt/string)
  const r = await cA.request({ method: "sim_fundAccount", params: [A.address, 1e19] });
  console.log("funded A:", r);
  console.log("A balance:", (await bal(A.address)).toString(), "=", B(await bal(A.address)), "GL");
  console.log("B balance:", (await bal(Bacc.address)).toString());

  // plain value transfer A -> B via sendTransaction / transfer
  console.log("\n--- plain value transfer 1 GL A->B ---");
  let hash;
  try {
    hash = await cA.request({
      method: "eth_sendTransaction",
      params: [{ from: A.address, to: Bacc.address, value: "0xde0b6b3a7640000" }],
    });
    console.log("tx:", hash);
  } catch (e) {
    console.log("eth_sendTransaction failed:", String(e.message || e).slice(0, 300));
    // try genlayer-js helper
    try {
      hash = await cA.sendTransaction({ to: Bacc.address, value: BigInt("1000000000000000000") });
      console.log("sendTransaction tx:", hash);
    } catch (e2) {
      console.log("sendTransaction failed:", String(e2.message || e2).slice(0, 300));
    }
  }

  if (hash) {
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      try {
        const tx = await cA.getTransaction({ hash });
        if (tx?.statusName === "FINALIZED" || tx?.statusName === "REJECTED") {
          console.log("status:", tx.statusName);
          break;
        }
      } catch (e) {}
    }
  }

  console.log("A balance:", B(await bal(A.address)), "GL");
  console.log("B balance:", B(await bal(Bacc.address)), "GL");

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
