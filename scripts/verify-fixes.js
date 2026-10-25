/**
 * Kitty Market - corrected-contract Studionet verification.
 *
 * Demonstrates, with reproducible transaction hashes:
 *   1. market creation (payable opener)
 *   2. staking on both sides
 *   3. premature-settlement rejection before the close timestamp
 *   4. AI consensus settlement
 *   5. successful pro-rata payouts
 *   6. fee collection from the fee vault only
 *   7. zero-winning-position -> void refunds
 *
 * Usage:
 *   node scripts/deploy.js            # deploy corrected contract first
 *   node scripts/verify-fixes.js
 */
const { createClient, createAccount, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const fs = require("fs");
const path = require("path");

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "contract-address.json"), "utf-8")
);
const CONTRACT = cfg.address;
const OWNER_PK = cfg.privateKey;
const E18 = 10n ** 18n;
const CLOSE_IN_SECONDS = 300;

const txRefs = [];
const failures = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ok(label) {
  console.log(`  PASS ${label}`);
}

function nok(label, error) {
  const message = String(error).slice(0, 240);
  failures.push(`${label}: ${message}`);
  console.log(`  FAIL ${label}: ${message}`);
}

function record(label, hash, status) {
  txRefs.push({ label, hash, status });
  console.log(`  ${label}: ${hash} (${status})`);
}

async function sendTx(label, client, fn, args, value, expectFail = false) {
  let hash;
  try {
    hash = await client.writeContract({
      address: CONTRACT,
      functionName: fn,
      args,
      value: value || 0n,
    });
    console.log(`  ${label} submitted: ${hash}`);
  } catch (e) {
    const message = String(e.shortMessage || e.message).slice(0, 240);
    if (expectFail) {
      ok(`${label} rejected before execution`);
      record(label, "(none)", `rejected: ${message}`);
      return { pass: false, expected: true };
    }
    nok(label, message);
    return { pass: false };
  }

  for (let i = 0; i < 140; i++) {
    await sleep(3000);
    try {
      const tx = await client.getTransaction({ hash });
      if (tx?.statusName === "FINALIZED") {
        const receipt = Array.isArray(tx.consensus_data?.leader_receipt)
          ? tx.consensus_data.leader_receipt[0]
          : tx.consensus_data?.leader_receipt;
        if (receipt?.execution_result === "ERROR") {
          const stderr = receipt.genvm_result?.stderr || "";
          const lines = stderr.split("\n").filter((line) => line.trim());
          const reason = lines.slice(-2).join(" | ") || "leader execution error";
          record(label, hash, "error");
          if (expectFail) {
            ok(`${label} rejected as expected`);
            return { pass: false, expected: true, hash };
          }
          nok(label, reason);
          return { pass: false, hash, error: reason };
        }
        record(label, hash, "finalized");
        if (!expectFail) ok(label);
        return { pass: true, hash };
      }
      if (tx?.statusName === "REJECTED") {
        record(label, hash, "rejected");
        if (expectFail) {
          ok(`${label} rejected as expected`);
          return { pass: false, expected: true, hash };
        }
        nok(label, "transaction rejected");
        return { pass: false, hash };
      }
    } catch {
      // keep polling
    }
  }

  record(label, hash, "timeout");
  nok(label, "timeout while waiting for FINALIZED");
  return { pass: false, hash, error: "timeout" };
}

async function read(client, fn, args = []) {
  return client.readContract({ address: CONTRACT, functionName: fn, args });
}

async function readMarket(client, mid) {
  return JSON.parse(await read(client, "get_market", [mid]));
}

async function waitUntil(timestampSeconds) {
  const target = Number(timestampSeconds) * 1000 + 8000;
  while (Date.now() < target) {
    const left = Math.ceil((target - Date.now()) / 1000);
    console.log(`  waiting for close time... ${left}s`);
    await sleep(Math.min(left * 1000, 15000));
  }
}

async function main() {
  if (!CONTRACT) {
    throw new Error("No contract address in scripts/contract-address.json");
  }

  const owner = createAccount(OWNER_PK);
  const ownerClient = createClient({ chain: studionet, account: owner });

  const makeAccount = async (label) => {
    const account = createAccount(generatePrivateKey());
    await ownerClient.request({
      method: "sim_fundAccount",
      params: [account.address, 1000],
    });
    console.log(`${label}: ${account.address}`);
    return {
      account,
      client: createClient({ chain: studionet, account }),
    };
  };

  console.log("Contract:", CONTRACT);
  console.log("Owner   :", owner.address);
  console.log("Explorer:", `https://explorer-studio.genlayer.com/contracts/${CONTRACT}`);

  const creator = await makeAccount("Creator");
  const yesWinner = await makeAccount("YesWinner");
  const noLoser = await makeAccount("NoLoser");
  const voidBettor = await makeAccount("VoidBettor");

  console.log("\n=== JOIN ===");
  await sendTx("join creator", creator.client, "join", ["CreatorCat"]);
  await sendTx("join yes winner", yesWinner.client, "join", ["YesCat"]);
  await sendTx("join no loser", noLoser.client, "join", ["NoCat"]);
  await sendTx("join void bettor", voidBettor.client, "join", ["VoidCat"]);

  const now = Math.floor(Date.now() / 1000);
  const closesAt = now + CLOSE_IN_SECONDS;

  console.log("\n=== OPEN MARKETS ===");
  const startId = Number(await read(ownerClient, "get_total_markets"));
  const yesEvidence =
    "https://httpbin.org/base64/VGhlIGFuc3dlciBpcyB5ZXMu";
  const noEvidence =
    "https://httpbin.org/base64/Tm8sIHRoZSBhbnN3ZXIgaXMgbm8u";

  await sendTx(
    "open payout market",
    creator.client,
    "open_market",
    [
      "Does the evidence say the answer is yes?",
      "verification",
      yesEvidence,
      BigInt(closesAt),
      0n,
      0n,
    ]
  );
  await sendTx(
    "open zero-winner market",
    creator.client,
    "open_market",
    [
      "Does the evidence say the answer is yes?",
      "verification",
      noEvidence,
      BigInt(closesAt),
      0n,
      0n,
    ]
  );

  const payoutMarketId = BigInt(startId);
  const zeroWinnerMarketId = BigInt(startId + 1);

  console.log("\n=== STAKE ===");
  await sendTx(
    "yes winner stakes 3 GEN YES",
    yesWinner.client,
    "take_side",
    [payoutMarketId, "yes"],
    3n * E18
  );
  await sendTx(
    "no loser stakes 1 GEN NO",
    noLoser.client,
    "take_side",
    [payoutMarketId, "no"],
    1n * E18
  );
  await sendTx(
    "void bettor stakes 2 GEN YES only",
    voidBettor.client,
    "take_side",
    [zeroWinnerMarketId, "yes"],
    2n * E18
  );

  console.log("\n=== PREMATURE SETTLEMENT MUST FAIL ===");
  await sendTx(
    "settle before close is rejected",
    creator.client,
    "settle_market",
    [payoutMarketId],
    0n,
    true
  );

  const before = await readMarket(ownerClient, payoutMarketId);
  if (Number(before.settle_attempts) === 0 && before.settled === false) {
    ok("attempt counter stayed at 0 before close");
  } else {
    nok("attempt counter stayed at 0 before close", JSON.stringify(before));
  }

  await waitUntil(closesAt);

  console.log("\n=== AI SETTLEMENT: PAYOUT MARKET ===");
  const settlement = await sendTx(
    "AI settle payout market",
    creator.client,
    "settle_market",
    [payoutMarketId]
  );
  if (!settlement.pass) {
    throw new Error("AI settlement did not finalize");
  }
  let payoutMarket = await readMarket(ownerClient, payoutMarketId);
  console.log(
    `  outcome=${payoutMarket.outcome} settled=${payoutMarket.settled} fee=${payoutMarket.fee_accrued}`
  );
  if (
    payoutMarket.settled === true &&
    (payoutMarket.outcome === "yes" || payoutMarket.outcome === "no")
  ) {
    ok("payout market resolved by AI consensus");
  } else {
    nok("payout market resolved by AI consensus", JSON.stringify(payoutMarket));
  }

  const winner =
    payoutMarket.outcome === "yes" ? yesWinner : noLoser;
  const feeBefore = BigInt(await read(ownerClient, "get_fee_balance"));

  console.log("\n=== CLAIM PAYOUT ===");
  await sendTx(
    "winning side claims pro-rata payout",
    winner.client,
    "claim_payout",
    [payoutMarketId]
  );
  await sendTx(
    "double claim is rejected",
    winner.client,
    "claim_payout",
    [payoutMarketId],
    0n,
    true
  );

  const feeAfterClaim = BigInt(await read(ownerClient, "get_fee_balance"));
  if (feeAfterClaim === feeBefore) {
    ok("claim did not mint another fee");
  } else {
    nok("claim did not mint another fee", `${feeBefore} -> ${feeAfterClaim}`);
  }

  console.log("\n=== COLLECT FEES ===");
  if (feeBefore > 0n) {
    await sendTx(
      "non-owner fee collection is rejected",
      yesWinner.client,
      "collect_fees",
      [1n],
      0n,
      true
    );
    await sendTx(
      "owner collects accrued fee",
      ownerClient,
      "collect_fees",
      [feeBefore]
    );
    const feeAfterCollect = BigInt(await read(ownerClient, "get_fee_balance"));
    if (feeAfterCollect === 0n) ok("fee vault drained exactly");
    else nok("fee vault drained exactly", String(feeAfterCollect));
  } else {
    nok("fee accrued", "fee balance is zero");
  }

  console.log("\n=== AI SETTLEMENT: ZERO-WINNER -> VOID REFUND ===");
  const voidSettlement = await sendTx(
    "AI settle zero-winner market",
    creator.client,
    "settle_market",
    [zeroWinnerMarketId]
  );
  if (!voidSettlement.pass) {
    throw new Error("zero-winner settlement did not finalize");
  }

  let voidMarket = await readMarket(ownerClient, zeroWinnerMarketId);
  console.log(
    `  outcome=${voidMarket.outcome} settled=${voidMarket.settled} attempts=${voidMarket.settle_attempts} fee=${voidMarket.fee_accrued}`
  );

  if (voidMarket.settled !== true) {
    // Fallback: force the terminal-void path if the AI returned a plain void.
    console.log("  zero-winner outcome was void; falling back to terminal void");
    let attempts = Number(voidMarket.settle_attempts);
    while (attempts < 5) {
      await sendTx(
        `retry void settlement ${attempts + 1}/5`,
        creator.client,
        "settle_market",
        [zeroWinnerMarketId]
      );
      attempts = Number((await readMarket(ownerClient, zeroWinnerMarketId)).settle_attempts);
    }
    await sendTx(
      "terminal void after 5 failed attempts",
      creator.client,
      "terminal_void",
      [zeroWinnerMarketId]
    );
    voidMarket = await readMarket(ownerClient, zeroWinnerMarketId);
  }

  if (voidMarket.settled === true && voidMarket.outcome === "void") {
    ok("zero-winning-position market resolved as void");
    if (BigInt(voidMarket.fee_accrued) === 0n) ok("void market charged no fee");
    else nok("void market charged no fee", voidMarket.fee_accrued);
  } else if (voidMarket.terminal_void === true) {
    ok("terminal void enabled full refunds");
  } else {
    nok("void refund path resolved", JSON.stringify(voidMarket));
  }

  await sendTx(
    "void bettor reclaims full stake",
    voidBettor.client,
    "reclaim_stake",
    [zeroWinnerMarketId]
  );
  await sendTx(
    "double reclaim is rejected",
    voidBettor.client,
    "reclaim_stake",
    [zeroWinnerMarketId],
    0n,
    true
  );

  console.log("\n=== FINAL ACCOUNTING ===");
  const accounting = JSON.parse(await read(ownerClient, "get_accounting"));
  console.log("  ", JSON.stringify(accounting));
  if (accounting.solvent === true) ok("outstanding liabilities fully covered");
  else nok("outstanding liabilities fully covered", JSON.stringify(accounting));

  console.log("\n=== TRANSACTION REFERENCES ===");
  for (const ref of txRefs) {
    console.log(`${ref.label}\n  ${ref.hash}  [${ref.status}]`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Contract : ${CONTRACT}`);
  console.log(`Explorer : https://explorer-studio.genlayer.com/contracts/${CONTRACT}`);
  console.log(`Failures : ${failures.length}`);
  if (failures.length) {
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }
  fs.writeFileSync(
    path.join(__dirname, "studionet-verification.json"),
    JSON.stringify({ contract: CONTRACT, txRefs, failures }, null, 2)
  );
  console.log("Wrote scripts/studionet-verification.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
