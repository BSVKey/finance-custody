#!/usr/bin/env node
// A sample tokenized Treasury-bill fund over 30 days. The custodian signs daily holdings (12
// positions, one root); one day's attestation never arrives and the attestation service
// records the gap. On day 24 the stated holdings fall below the token supply. A holder proves
// one position without seeing the rest. A stablecoin issuer's monthly reserve reports: one on
// time, one late and later revised. Finally a recorded yield-curve file is checked against a
// later copy that was quietly changed. Every name, identifier and amount here is sample data.
//   node demo.mjs
import { genKeypair } from "./lib/keys.mjs";
import { signRecord, contentOf } from "./lib/record.mjs";
import { commitPositions, positionProof, positionIncluded, holdings, reserve, countersign, release, gap, fileFingerprint } from "./src/records.mjs";
import { verifyHoldings, verifyReserves, checkRelease } from "./src/verify.mjs";

const DAY = 86400000, T0 = Date.parse("2026-09-01T00:00:00Z");
const d = (t) => new Date(t).toISOString().slice(0, 10);
const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const [custodian, service, issuer, accountant, recorder] = Array.from({ length: 5 }, genKeypair);

// Holdings: 11 bills plus cash. The fund grows; on day 24 one bill drops out of the stated book.
const fullBook = (day) => {
  const ps = Array.from({ length: 11 }, (_, i) => ({ id: `SAMPLE${String(i + 1).padStart(3, "0")}`, type: "tbill", parCents: 5_000_000_00, valueCents: 4_960_000_00 + i * 1_500_00 + day * 70_00, maturity: `2026-${String(11 + (i % 2)).padStart(2, "0")}-${String(5 + i).padStart(2, "0")}` }));
  ps.push({ id: "CASH", type: "cash", parCents: 1_200_000_00 + day * 25_000_00, valueCents: 1_200_000_00 + day * 25_000_00, maturity: "-" });
  return ps;
};
const book = (day) => (day >= 23 ? fullBook(day).filter((p) => p.id !== "SAMPLE007") : fullBook(day));
const series = [], outstanding = new Map(), commits = new Map();
let prev = null;
for (let day = 0; day < 30; day++) {
  const asOf = T0 + day * DAY;
  const supply = commitPositions(fullBook(day)).totalCents - 900_00;                  // tokens issued against the full book
  outstanding.set(asOf, supply);
  if (day === 16) continue;                                                           // attestation never arrives
  const c = commitPositions(book(day));
  commits.set(asOf, c);
  prev = holdings(custodian, { fund: "sample-tbill-fund", custodian: "sample-custodian", asOf, seq: prev ? prev.seq + 1 : 0, prev: prev?.claimId ?? null, c });
  series.push(prev);
}
const gaps = [gap(service, { service: "attestation-service", subject: "sample-tbill-fund", expected: T0 + 16 * DAY, noticedAt: T0 + 16 * DAY + 6 * 3600000, what: "holdings" })];

const v = verifyHoldings(series, { custodianPub: custodian.pub, servicePub: service.pub, gaps, from: T0, to: T0 + 29 * DAY, outstanding });
console.log(`Sample T-bill fund, ${d(T0)} to ${d(T0 + 29 * DAY)}: ${series.length} daily holdings attestations, ${series[0].positionCount} positions each, one root per day`);
console.log(`Series verified (signatures, chain, every day accounted for): ${v.ok ? "PASS" : "FAIL " + JSON.stringify(v.problems)}`);
for (const x of v.days.filter((x) => x.status !== "attested" || x.below || x.asOf === T0)) {
  console.log(`  ${d(x.asOf)}  ${x.status === "attested" ? `stated holdings ${usd(x.totalCents)} vs tokens outstanding ${usd(x.outstandingCents)}: ${x.coverage}%${x.below ? "  BELOW SUPPLY" : ""}` : x.status}`);
}
const below = v.days.filter((x) => x.below);
console.log(`  ${below.length} days with stated holdings below supply, from ${d(below[0].asOf)}`);

const day10 = T0 + 9 * DAY, rec10 = series.find((r) => r.asOf === day10), pos = book(9)[3];
console.log(`\nA holder checks one position on ${d(day10)} without seeing the rest:`);
console.log(`  ${pos.id}, par ${usd(pos.parCents)}, value ${usd(pos.valueCents)}: ${positionIncluded(rec10, pos, positionProof(commits.get(day10), pos))}`);
console.log(`  same position with value raised by $1: ${positionIncluded(rec10, { ...pos, valueCents: pos.valueCents + 100 }, positionProof(commits.get(day10), pos))}`);

// Reserve reports: deadline is the 10th of the following month.
const deadline = (p) => { const [y, m] = p.split("-").map(Number); return Date.UTC(y, m, 10, 23, 59); };
const rep = (period, text, at) => reserve(issuer, { issuer: "sample-stablecoin", period, reportFp: fileFingerprint(Buffer.from(text)), totalsByType: { tbill: 900_000_000_00, cash: 100_000_000_00 }, totalCents: Number(text.match(/total (\d+)/)[1]), publishedAt: at });
const aug = rep("2026-08", "sample reserve report Aug total 100000000000", Date.UTC(2026, 8, 8));
const sep1 = rep("2026-09", "sample reserve report Sep total 100500000000", Date.UTC(2026, 9, 14));
const sep2 = rep("2026-09", "sample reserve report Sep (revised) total 100200000000", Date.UTC(2026, 9, 20));
const cs = [countersign(accountant, { reserveId: aug.claimId, accountant: "sample-accountant", at: Date.UTC(2026, 8, 9) }), countersign(accountant, { reserveId: sep1.claimId, accountant: "sample-accountant", at: Date.UTC(2026, 9, 15) })];
const r = verifyReserves([aug, sep1, sep2], { issuerPub: issuer.pub, accountantPub: accountant.pub, countersigns: cs, deadline });
console.log(`\nStablecoin reserve reports verified: ${r.ok ? "PASS" : "FAIL"}`);
for (const p of r.periods) console.log(`  ${p.period}  published ${d(p.publishedAt)}${p.late ? " LATE" : " on time"}${p.revised ? `, REVISED (${p.versions} versions, total ${usd(p.firstTotalCents)} -> ${usd(p.latestTotalCents)})` : ""}, countersigned: ${p.countersigned ? "latest version" : p.countersignedVersion >= 0 ? `version ${p.countersignedVersion + 1} only` : "no"}`);

// Official data: a yield-curve file recorded when fetched, then a changed copy.
const curve = Buffer.from("date,1mo,3mo,6mo,1yr\n2026-10-05,4.01,3.98,3.91,3.80\n");
const rr = release(recorder, { recorder: "recording-service", source: "sample yield curve", url: "https://example.org/sample-yield-curve.csv", fetchedAt: Date.UTC(2026, 9, 5, 21), fp: fileFingerprint(curve), bytes: curve.length });
console.log(`\nRecorded data release (${d(rr.fetchedAt)}):`);
console.log(`  the file as fetched:                   ${checkRelease(rr, curve, { recorderPub: recorder.pub }).verdict}`);
console.log(`  a later copy with 3mo changed to 3.96: ${checkRelease(rr, Buffer.from(curve.toString().replace("3.98", "3.96")), { recorderPub: recorder.pub }).verdict}`);

console.log("\nTampering:");
const say = (label, res) => console.log(`  ${label.padEnd(58)} ${res.ok ? "NOT CAUGHT" : "caught: " + [...new Set(res.problems.map((x) => x.reason))].join(", ")}`);
const hv = (s, extra = {}) => verifyHoldings(s, { custodianPub: custodian.pub, servicePub: service.pub, gaps, from: T0, to: T0 + 29 * DAY, outstanding, ...extra });
say("custodian quietly re-issues day 24 with the bill restored", hv(series.map((x) => (x.asOf === T0 + 23 * DAY ? holdings(custodian, { ...contentOf(x), c: commitPositions(fullBook(23)) }) : x))));
say("a day's attestation deleted with no gap record", hv(series.filter((x) => x.asOf !== T0 + 5 * DAY)));
say("issuer signs holdings in the custodian's place", hv(series.map((x, i) => (i === 3 ? signRecord(issuer, contentOf(x)) : x))));
say("gap record forged by the custodian", hv(series, { gaps: [signRecord(custodian, contentOf(gaps[0]))] }));
say("September's revision passed off as countersigned", { ...verifyReserves([aug, sep1, sep2], { issuerPub: issuer.pub, accountantPub: accountant.pub, countersigns: [...cs, signRecord(issuer, { ...contentOf(cs[1]), reserveId: sep2.claimId })], deadline }) });
