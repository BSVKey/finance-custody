// Signed attestations about what backs a tokenized fund or stablecoin, and about official data.
// Evidence only: a record proves what its signer stated, and when, not that it is true.
//
//   finance.holdings/1       signed by the CUSTODIAN for each as-of date: one Merkle root over
//                            every position, the count, and totals by type. Chained day to day.
//                            Any single position can be proven without revealing the rest.
//   finance.reserve/1        signed by the ISSUER: a fingerprint of a reserve report, its totals
//                            and the period it covers.
//   finance.countersign/1    signed by the issuer's ACCOUNTANT: names one reserve record.
//   finance.release/1        signed by a recording service: a fingerprint of a published data
//                            release, where it was fetched from, and when.
//   finance.gap/1            signed by the attestation service: an expected attestation or report
//                            did not arrive.
//
// Amounts are integer cents.
import { createHash } from "node:crypto";
import { signRecord } from "../lib/record.mjs";
import { leafHash, buildTree, proof, verifyProof } from "../lib/merkle.mjs";

export const fileFingerprint = (bytes) => "0x" + createHash("sha256").update(bytes).digest("hex");
const leaf = (s) => leafHash(Buffer.from(s, "utf8"));
export const positionKey = (p) => `${p.id}|${p.type}|${p.parCents}|${p.valueCents}|${p.maturity}`;

export function commitPositions(positions) {
  const keys = positions.map(positionKey).sort();
  if (new Set(keys).size !== keys.length) throw new Error("commitPositions: duplicate position");
  const tree = buildTree(keys.map(leaf));
  const totalsByType = {};
  for (const p of positions) totalsByType[p.type] = (totalsByType[p.type] || 0) + p.valueCents;
  return { root: tree.root, count: keys.length, keys, tree, totalsByType, totalCents: positions.reduce((a, p) => a + p.valueCents, 0) };
}
export const positionProof = (c, p) => { const i = c.keys.indexOf(positionKey(p)); return i < 0 ? null : { index: i, branch: proof(c.tree, i) }; };
export const positionIncluded = (rec, p, pr) => !!pr && pr.index >= 0 && pr.index < rec.positionCount && verifyProof(leaf(positionKey(p)), pr.branch, pr.index, rec.positionsRoot);

export const holdings = (kp, { fund, custodian, asOf, seq, prev, c }) =>
  signRecord(kp, { kind: "finance.holdings/1", fund, custodian, asOf, seq, prev, positionsRoot: c.root, positionCount: c.count, totalsByType: c.totalsByType, totalCents: c.totalCents });

export const reserve = (kp, { issuer, period, reportFp, totalsByType, totalCents, publishedAt }) =>
  signRecord(kp, { kind: "finance.reserve/1", issuer, period, reportFp, totalsByType, totalCents, publishedAt });

export const countersign = (kp, { reserveId, accountant, at }) =>
  signRecord(kp, { kind: "finance.countersign/1", reserveId, accountant, at });

export const release = (kp, { recorder, source, url, fetchedAt, fp, bytes }) =>
  signRecord(kp, { kind: "finance.release/1", recorder, source, url, fetchedAt, fp, bytes });

export const gap = (kp, { service, subject, expected, noticedAt, what }) =>
  signRecord(kp, { kind: "finance.gap/1", service, subject, expected, noticedAt, what });
