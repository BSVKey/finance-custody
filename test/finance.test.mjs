import test from "node:test";
import assert from "node:assert/strict";
import { genKeypair } from "../lib/keys.mjs";
import { signRecord, contentOf } from "../lib/record.mjs";
import { commitPositions, positionProof, positionIncluded, holdings, reserve, countersign, release, gap, fileFingerprint } from "../src/records.mjs";
import { verifyHoldings, verifyReserves, checkRelease } from "../src/verify.mjs";

const DAY = 86400000, T0 = Date.parse("2026-09-01T00:00:00Z");
const ps = [{ id: "A", type: "tbill", parCents: 1000, valueCents: 990, maturity: "2026-12-01" }, { id: "B", type: "tbill", parCents: 2000, valueCents: 1985, maturity: "2027-01-01" }, { id: "C", type: "cash", parCents: 500, valueCents: 500, maturity: "-" }];

function series(days, skip = []) {
  const cust = genKeypair(), svc = genKeypair();
  const out = []; let prev = null;
  for (let i = 0; i < days; i++) {
    if (skip.includes(i)) continue;
    prev = holdings(cust, { fund: "f", custodian: "c", asOf: T0 + i * DAY, seq: prev ? prev.seq + 1 : 0, prev: prev?.claimId ?? null, c: commitPositions(ps) });
    out.push(prev);
  }
  return { cust, svc, out, opts: { custodianPub: cust.pub, servicePub: svc.pub, from: T0, to: T0 + (days - 1) * DAY } };
}

test("commitment totals by type and proves one position", () => {
  const c = commitPositions(ps);
  assert.deepEqual(c.totalsByType, { tbill: 2975, cash: 500 });
  assert.equal(c.totalCents, 3475);
  const rec = holdings(genKeypair(), { fund: "f", custodian: "c", asOf: T0, seq: 0, prev: null, c });
  assert.equal(positionIncluded(rec, ps[1], positionProof(c, ps[1])), true);
  assert.equal(positionIncluded(rec, { ...ps[1], parCents: 2001 }, positionProof(c, ps[1])), false);
  assert.throws(() => commitPositions([ps[0], ps[0]]), /duplicate/);
});

test("every day is attested or recorded missing; coverage against supply", () => {
  const s = series(5, [2]);
  const missing = verifyHoldings(s.out, s.opts);
  assert.deepEqual(missing.problems.map((p) => p.reason), ["missing_day_not_recorded"]);
  const g = gap(s.svc, { service: "svc", subject: "f", expected: T0 + 2 * DAY, noticedAt: T0 + 2 * DAY, what: "holdings" });
  const ok = verifyHoldings(s.out, { ...s.opts, gaps: [g], outstanding: new Map([[T0, 3475], [T0 + DAY, 3500]]) });
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
  assert.equal(ok.days[0].coverage, 100);
  assert.equal(ok.days[1].below, true);
  assert.equal(ok.days[2].status, "missing (recorded)");
  const forgedGap = verifyHoldings(s.out, { ...s.opts, gaps: [signRecord(s.cust, contentOf(g))] });
  assert.equal(forgedGap.ok, false);
});

test("re-issued or wrongly signed days break the series", () => {
  const s = series(4);
  const reissued = s.out.map((x, i) => (i === 1 ? signRecord(s.cust, { ...contentOf(x), totalCents: 1 }) : x));
  assert.ok(verifyHoldings(reissued, s.opts).problems.some((p) => p.reason === "series_chain_break"));
  const other = s.out.map((x, i) => (i === 3 ? signRecord(genKeypair(), contentOf(x)) : x));
  assert.ok(verifyHoldings(other, s.opts).problems.some((p) => p.reason === "signer_not_pinned_key"));
});

test("reserve reports: late, revised, and which version was countersigned", () => {
  const iss = genKeypair(), acc = genKeypair();
  const r = (period, total, at) => reserve(iss, { issuer: "i", period, reportFp: fileFingerprint(Buffer.from(String(total))), totalsByType: {}, totalCents: total, publishedAt: at });
  const a = r("2026-08", 100, Date.UTC(2026, 8, 5)), b1 = r("2026-09", 200, Date.UTC(2026, 9, 12)), b2 = r("2026-09", 190, Date.UTC(2026, 9, 20));
  const deadline = (p) => { const [y, m] = p.split("-").map(Number); return Date.UTC(y, m, 10); };
  const v = verifyReserves([b2, a, b1], { issuerPub: iss.pub, accountantPub: acc.pub, countersigns: [countersign(acc, { reserveId: b1.claimId, accountant: "x", at: 0 })], deadline });
  assert.equal(v.ok, true);
  const sep = v.periods.find((p) => p.period === "2026-09");
  assert.deepEqual([sep.late, sep.revised, sep.firstTotalCents, sep.latestTotalCents, sep.countersigned, sep.countersignedVersion], [true, true, 200, 190, false, 0]);
  assert.equal(v.periods.find((p) => p.period === "2026-08").late, false);
});

test("a recorded release matches the fetched bytes and nothing else", () => {
  const rec = genKeypair(), bytes = Buffer.from("a,b\n1,2\n");
  const rr = release(rec, { recorder: "r", source: "s", url: "u", fetchedAt: 0, fp: fileFingerprint(bytes), bytes: bytes.length });
  assert.equal(checkRelease(rr, bytes, { recorderPub: rec.pub }).same, true);
  assert.equal(checkRelease(rr, Buffer.from("a,b\n1,3\n"), { recorderPub: rec.pub }).same, false);
  assert.equal(checkRelease(rr, bytes, { recorderPub: genKeypair().pub }).ok, false);
});

test("a position proof does not give away the positions beside it", async () => {
  const { leafHash } = await import("../lib/merkle.mjs");
  const { positionKey } = await import("../src/records.mjs");
  const ps = Array.from({ length: 8 }, (_, i) => ({ id: `T-${i}`, type: "tbill", parCents: 100_000_00, valueCents: 99_500_00, maturity: "2027-01-15" }));
  const c = commitPositions(ps);
  const pr = positionProof(c, ps[3]);
  assert.equal(ps.map((p) => leafHash(Buffer.from(positionKey(p), "utf8"))).includes(pr.branch[0]), false);
  assert.equal(positionIncluded({ positionsRoot: c.root, positionCount: c.count }, ps[3], { ...pr, salt: undefined }), false);
});
