// Signed attestations about what backs a tokenized fund or stablecoin, and about official data.
// Evidence only: a record proves what its signer stated, and when, not that it is true.
//
//   finance.holdings/1       signed by the CUSTODIAN for each as-of date: one Merkle root over
//                            every position, the count, and totals by type. Chained day to day.
//                            Any single position can be proven without revealing the rest
//                            (salted leaves, see below).
//   finance.reserve/1        signed by the ISSUER: a fingerprint of a reserve report, its totals
//                            and the period it covers.
//   finance.countersign/1    signed by the issuer's ACCOUNTANT: names one reserve record.
//   finance.release/1        signed by a recording service: a fingerprint of a published data
//                            release, where it was fetched from, and when.
//   finance.gap/1            signed by the attestation service: an expected attestation or report
//                            did not arrive.
//
// Amounts are integer cents.
import { createHash, randomBytes } from "node:crypto";
import { signRecord } from "../lib/record.mjs";
import { leafHash, buildTree, proof, verifyProof } from "../lib/merkle.mjs";

export const fileFingerprint = (bytes) => "0x" + createHash("sha256").update(bytes).digest("hex");
// Leaves are salted (salted-leaf/1): each item gets 16 random bytes, and leaves are ordered by
// their salted hash. Without the salt, the sibling hashes in one item's proof could be matched
// against guessed values to reveal the items next to it. The salt travels only in that item's
// own proof. saltOf(key) can be supplied for reproducible commitments.
export const LEAF_SCHEME = "salted-leaf/1";
const SALT_RE = /^[0-9a-f]{32}$/;
const randomSalt = () => randomBytes(16).toString("hex");
const saltedLeaf = (salt, s) => leafHash(Buffer.from(`${salt}|${s}`, "utf8"));
function commitSalted(keys, saltOf = randomSalt) {
  const entries = keys.map((key) => {
    const salt = saltOf(key);
    if (!SALT_RE.test(salt)) throw new Error("salt must be 32 lowercase hex characters");
    return { key, salt, leaf: saltedLeaf(salt, key) };
  }).sort((a, b) => (a.leaf < b.leaf ? -1 : a.leaf > b.leaf ? 1 : 0));
  const tree = buildTree(entries.map((e) => e.leaf));
  return { root: tree.root, count: entries.length, scheme: LEAF_SCHEME, keys: entries.map((e) => e.key), salts: entries.map((e) => e.salt), tree };
}
const saltedProof = (c, key) => { const i = c.keys.indexOf(key); return i < 0 ? null : { index: i, salt: c.salts[i], branch: proof(c.tree, i) }; };
const saltedMember = (root, count, key, p) => !!p && SALT_RE.test(p.salt) && p.index >= 0 && p.index < count && verifyProof(saltedLeaf(p.salt, key), p.branch, p.index, root);
export const positionKey = (p) => `${p.id}|${p.type}|${p.parCents}|${p.valueCents}|${p.maturity}`;

export function commitPositions(positions, { saltOf } = {}) {
  const keys = positions.map(positionKey);
  if (new Set(keys).size !== keys.length) throw new Error("commitPositions: duplicate position");
  const totalsByType = {};
  for (const p of positions) totalsByType[p.type] = (totalsByType[p.type] || 0) + p.valueCents;
  return { ...commitSalted(keys, saltOf), totalsByType, totalCents: positions.reduce((a, p) => a + p.valueCents, 0) };
}
export const positionProof = (c, p) => saltedProof(c, positionKey(p));
export const positionIncluded = (rec, p, pr) => saltedMember(rec.positionsRoot, rec.positionCount, positionKey(p), pr);

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
