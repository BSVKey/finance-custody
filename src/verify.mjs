// Verify holdings series, reserve reports and recorded data releases.
//
// Every check here is about what was signed, by whom and when. Coverage compares the
// custodian's STATED holdings with the token supply the verifier reads itself; it is
// evidence for an auditor or a holder, not an audit.
import { verifyRecord } from "../lib/record.mjs";
import { fileFingerprint } from "./records.mjs";

const DAY = 86400000;
const signedBy = (r, pub) => { const v = verifyRecord(r); return !v.ok ? v.reason : v.signer !== pub ? "signer_not_pinned_key" : null; };

// A daily holdings series.
//   series:      holdings records as published
//   gaps:        finance.gap/1 records from the attestation service
//   outstanding: Map asOf -> token supply in cents, read by the verifier from the token itself
// Each expected day must have a holdings record or a signed gap record; each record must be
// signed by the custodian and chained to the one before.
export function verifyHoldings(series, { custodianPub, servicePub, gaps = [], from, to, outstanding }) {
  const problems = [];
  const days = [];
  const byDay = new Map(series.map((r) => [r.asOf, r]));
  const gapDays = new Map(gaps.filter((g) => !signedBy(g, servicePub)).map((g) => [g.expected, g]));
  let prev = null;
  for (let d = from; d <= to; d += DAY) {
    const r = byDay.get(d);
    if (!r) {
      const g = gapDays.get(d);
      days.push({ asOf: d, status: g ? "missing (recorded)" : "missing (unrecorded)" });
      if (!g) problems.push({ reason: "missing_day_not_recorded", asOf: d });
      continue;
    }
    const s = signedBy(r, custodianPub);
    if (s) { problems.push({ reason: s, asOf: d }); days.push({ asOf: d, status: "invalid" }); continue; }
    if (prev && (r.prev !== prev.claimId || r.seq !== prev.seq + 1)) problems.push({ reason: "series_chain_break", asOf: d });
    const out = outstanding?.get(d);
    const coverage = out ? Math.floor((r.totalCents * 10000) / out) / 100 : null;
    days.push({ asOf: d, status: "attested", totalCents: r.totalCents, outstandingCents: out ?? null, coverage, below: out !== undefined && r.totalCents < out });
    prev = r;
  }
  return { ok: problems.length === 0, problems, days };
}

// Reserve reports, one or more per period (a later one for the same period is a revision).
//   deadline(period) -> ms by which the report must be published
// Late and revised reports are reported, not hidden; countersignatures are matched to the
// exact report version they name.
export function verifyReserves(reports, { issuerPub, accountantPub, countersigns = [], deadline }) {
  const problems = [], periods = new Map();
  for (const r of reports) {
    const s = signedBy(r, issuerPub);
    if (s) { problems.push({ reason: s, period: r.period }); continue; }
    periods.set(r.period, [...(periods.get(r.period) || []), r].sort((a, b) => a.publishedAt - b.publishedAt));
  }
  const cs = new Map();
  for (const c of countersigns) {
    const s = signedBy(c, accountantPub);
    if (s) { problems.push({ reason: "countersignature_" + s }); continue; }
    cs.set(c.reserveId, c);
  }
  const out = [...periods].map(([period, versions]) => {
    const first = versions[0], latest = versions.at(-1);
    return {
      period, versions: versions.length, publishedAt: first.publishedAt, late: first.publishedAt > deadline(period),
      revised: versions.length > 1, latestTotalCents: latest.totalCents, firstTotalCents: first.totalCents,
      countersigned: cs.has(latest.claimId), countersignedVersion: versions.findIndex((v) => cs.has(v.claimId)),
    };
  });
  return { ok: problems.length === 0, problems, periods: out };
}

// A published data file checked against what was recorded when it was fetched.
export function checkRelease(rec, bytes, { recorderPub }) {
  const s = signedBy(rec, recorderPub);
  if (s) return { ok: false, reason: s };
  const same = fileFingerprint(bytes) === rec.fp && bytes.length === rec.bytes;
  return { ok: true, same, verdict: same ? "matches the version recorded" : "differs from the version recorded", fetchedAt: rec.fetchedAt };
}
