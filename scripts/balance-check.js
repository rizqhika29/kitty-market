const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function bal(client, addr) {
  const r = await client.request({ method: "eth_getBalance", params: [addr, "latest"] });
  return BigInt(r);
}

async function sendTx(label, c, fn, args, value) {
  try {
    const h = await c.writeContract({ address: CONTRACT, functionName: fn, args, value: value || BigInt(0) });
    console.log(`  ${label} tx: ${h}`);
    for (let i = 0; i < 100; i++) {
      await sleep(3000);
      try {
        const tx = await c.getTransaction({ hash: h });
        if (tx?.statusName === "FINALIZED") {
          const lr = Array.isArray(tx.consensus_data?.leader_receipt) ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
          const er = lr?.execution_result;
          if (er === "ERROR") {
            const stderr = lr.genvm_result?.stderr || "";
            const res = lr.result;
            let resTxt = "";
            try { resTxt = Buffer.from(res, "base64").toString("utf8").slice(0, 200); } catch (e) {}
            const lines = stderr.split("\n").filter(l => l.trim());
            console.log(`  ${label} LEADER_ERROR: ${(lines.slice(-2).join(" | ") || resTxt)}`);
            return { pass: false, hash: h, error: "leader ERROR" };
          }
          console.log(`  ${label} FINALIZED (${er || "?"})`);
          return { pass: true, hash: h };
        }
        if (tx?.statusName === "REJECTED") { console.log(`  ${label} REJECTED`); return { pass: false }; }
      } catch (e) {}
    }
    console.log(`  ${label} TIMEOUT`);
    return { pass: false, error: "timeout" };
  } catch (e) {
    console.log(`  ${label} ERR: ${String(e.shortMessage || e.message).slice(0, 200)}`);
    return { pass: false, error: String(e.shortMessage || e.message).slice(0, 200) };
  }
}

let CONTRACT = null;

function gwei(x) { return (Number(x) / 1e18).toFixed(6); }

async function main() {
  const owner = createAccount(generatePrivateKey());
  const client = createClient({ chain: studionet, account: owner });
  const mk = async (label) => {
    const a = createAccount(generatePrivateKey());
    await client.request({ method: "sim_fundAccount", params: [a.address, 1000] });
    return { a, c: createClient({ chain: studionet, account: a }), label };
  };
  const creator = await mk("Creator");
  const winner = await mk("Winner");
  const loser = await mk("Loser");

  console.log("owner  ", owner.address);
  console.log("creator", creator.a.address);
  console.log("winner ", winner.a.address);
  console.log("loser  ", loser.a.address);

  // deploy with OWNER as constructor arg so owner = contract owner
  const code = fs.readFileSync(path.join(__dirname, "..", "contracts", "kitty_market.py"), "utf-8");
  const deployHash = await client.deployContract({
    code: new TextEncoder().encode(code),
    args: [owner.address],
    value: BigInt(0),
  });
  console.log("deploy tx:", deployHash);
  let deployed = false;
  for (let i = 0; i < 100; i++) {
    await sleep(3000);
    try {
      const tx = await client.getTransaction({ hash: deployHash });
      if (tx?.statusName === "FINALIZED") {
        const lr = Array.isArray(tx.consensus_data?.leader_receipt) ? tx.consensus_data.leader_receipt[0] : tx.consensus_data?.leader_receipt;
        if (lr?.execution_result === "ERROR") { console.log("DEPLOY FAILED:", lr.genvm_result?.stderr?.substring(0, 600)); process.exit(1); }
        CONTRACT = tx.data?.contract_address || tx.recipient;
        deployed = true; break;
      }
    } catch (e) {}
    if (i % 10 === 0) console.log(`  waiting deploy (${i * 3}s)...`);
  }
  if (!deployed) { console.log("DEPLOY TIMEOUT"); process.exit(1); }
  console.log("CONTRACT:", CONTRACT);
  console.log("explorer:", `https://explorer-studio.genlayer.com/contracts/${CONTRACT}`);

  // baseline balances
  const b = {};
  const snap = async (tag) => {
    b[tag] = {
      contract: await bal(client, CONTRACT),
      owner: await bal(client, owner.address),
      winner: await bal(client, winner.a.address),
      loser: await bal(client, loser.a.address),
      creator: await bal(client, creator.a.address),
    };
    console.log(`\n-- balances ${tag} --`);
    for (const k of Object.keys(b[tag])) console.log(`   ${k.padEnd(9)} ${gwei(b[tag][k])} GL`);
  };
  await snap("baseline");

  console.log("\n=== JOIN ===");
  await sendTx("join owner", client, "join", ["Owner"]);
  await sendTx("join creator", creator.c, "join", ["Creator"]);
  await sendTx("join winner", winner.c, "join", ["Winner"]);
  await sendTx("join loser", loser.c, "join", ["Loser"]);

  console.log("\n=== OPEN ===");
  const now = Math.floor(Date.now() / 1000);
  await sendTx("open_market", creator.c, "open_market", [
    "Is the sky blue?", "science", "https://en.wikipedia.org/wiki/Sky", BigInt(now + 86400), BigInt(0), BigInt(0),
  ]);
  const total = Number(await client.readContract({ address: CONTRACT, functionName: "get_total_markets", args: [] }));
  const mid = BigInt(total - 1);
  console.log("market id:", mid.toString());

  console.log("\n=== TAKE SIDES ===");
  await sendTx("winner YES 2 GEN", winner.c, "take_side", [mid, "yes"], BigInt(2000000000000000000));
  await sendTx("loser NO 1 GEN", loser.c, "take_side", [mid, "no"], BigInt(1000000000000000000));
  await snap("after bets");

  console.log("\n=== SETTLE ===");
  const rS = await sendTx("settle_market", client, "settle_market", [mid]);
  let m = JSON.parse(await client.readContract({ address: CONTRACT, functionName: "get_market", args: [mid] }));
  console.log(`  outcome="${m.outcome}" settled=${m.settled}`);
  if (!(m.settled && (m.outcome === "yes" || m.outcome === "no"))) { console.log("SETTLE DID NOT RESOLVE"); process.exit(1); }

  const winClient = m.outcome === "yes" ? winner.c : loser.c;
  const winLabel = m.outcome === "yes" ? "winner" : "loser";
  const winAddr = m.outcome === "yes" ? winner.a.address : loser.a.address;
  const loseAddr = m.outcome === "yes" ? loser.a.address : winner.a.address;

  const beforeClaim = {
    win: await bal(client, winAddr),
    lose: await bal(client, loseAddr),
    contract: await bal(client, CONTRACT),
  };

  console.log("\n=== CLAIM ===");
  const rC = await sendTx(`claim_payout (${winLabel})`, winClient, "claim_payout", [mid]);

  // give child tx time to finalize
  await sleep(15000);

  const afterClaim = {
    win: await bal(client, winAddr),
    lose: await bal(client, loseAddr),
    contract: await bal(client, CONTRACT),
  };

  console.log("\n=== CLAIM BALANCE DELTA ===");
  const dWin = afterClaim.win - beforeClaim.win;
  const dLose = afterClaim.lose - beforeClaim.lose;
  const dContract = afterClaim.contract - beforeClaim.contract;
  console.log(`  ${winLabel} (recipient): ${gwei(beforeClaim.win)} -> ${gwei(afterClaim.win)}  delta=${gwei(dWin)} GL`);
  console.log(`  other:                 ${gwei(beforeClaim.lose)} -> ${gwei(afterClaim.lose)}  delta=${gwei(dLose)} GL`);
  console.log(`  contract:              ${gwei(beforeClaim.contract)} -> ${gwei(afterClaim.contract)}  delta=${gwei(dContract)} GL`);

  let payoutOk = false;
  if (dWin > 0n) { console.log(`  PASS: payout DELIVERED (+${gwei(dWin)} GL)`); payoutOk = true; }
  else { console.log("  FAIL: payout NOT delivered to recipient (delta <= 0)"); }
  if (dContract < 0n) console.log(`  contract debited ${gwei(-dContract)} GL`);
  else console.log("  FAIL: contract NOT debited");

  console.log("\n=== FEES ===");
  const fb = await client.readContract({ address: CONTRACT, functionName: "get_fee_balance", args: [] });
  console.log("  fee_balance:", fb.toString());
  const ownerBefore = await bal(client, owner.address);
  const rF = await sendTx("collect_fees owner", client, "collect_fees", [BigInt(fb)]);
  await sleep(15000);
  const ownerAfter = await bal(client, owner.address);
  const dOwner = ownerAfter - ownerBefore;
  console.log(`  owner delta: ${gwei(dOwner)} GL`);
  let feeOk = dOwner > 0n;
  console.log(feeOk ? "  PASS: fees DELIVERED" : "  FAIL: fees NOT delivered");

  console.log("\n" + "=".repeat(60));
  console.log(`PAYOUT DELIVERED: ${payoutOk}`);
  console.log(`FEES DELIVERED  : ${feeOk}`);
  console.log(`CONTRACT        : ${CONTRACT}`);
  console.log("=".repeat(60));
  process.exit(payoutOk && feeOk ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
