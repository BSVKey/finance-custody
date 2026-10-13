# Finance Custody

Verifiable holdings attestations, reserve reports and recorded data releases.

Tokenized funds and stablecoins say their tokens are backed by real assets. Here the
custodian signs each day's holdings as one Merkle root over every position, so any single
position can be proven without revealing the rest (each leaf is salted, so one proof cannot be used to guess its neighbours); the issuer signs each reserve report,
and its accountant countersigns the exact version it reviewed; a missing attestation is
itself a signed record. A recording service fingerprints published data files, such as
yield curves, at the moment they are fetched.

```
npm test          # offline, zero dependencies
node demo.mjs     # a sample T-bill fund over 30 days, a stablecoin's reserve reports, a data file
```

## What the demo shows

```
Sample T-bill fund, 2026-09-01 to 2026-09-30: 29 daily holdings attestations, 12 positions each
Series verified (signatures, chain, every day accounted for): PASS
  2026-09-17  missing (recorded)
  2026-09-24  stated holdings $51,464,600 vs tokens outstanding $56,434,310: 91.19%  BELOW SUPPLY
  ...
  7 days with stated holdings below supply, from 2026-09-24

A holder checks one position on 2026-09-10 without seeing the rest:
  SAMPLE004, par $5,000,000, value $4,965,130: true
  same position with value raised by $1: false

Stablecoin reserve reports verified: PASS
  2026-08  published 2026-09-08 on time, countersigned: latest version
  2026-09  published 2026-10-14 LATE, REVISED (2 versions), countersigned: version 1 only

Recorded data release (2026-10-05):
  the file as fetched:                   matches the version recorded
  a later copy with 3mo changed to 3.96: differs from the version recorded

Tampering:
  custodian quietly re-issues day 24 with the bill restored  caught
  a day's attestation deleted with no gap record             caught
  issuer signs holdings in the custodian's place             caught
  gap record forged by the custodian                         caught
  September's revision passed off as countersigned           caught
```

Every name, identifier and amount in the demo is sample data.

## Records

| Record | Signed by | Says |
|---|---|---|
| `finance.holdings/1` | the custodian | for one as-of date: a Merkle root over all positions, the count, and totals by type; chained day to day |
| `finance.reserve/1` | the issuer | a fingerprint of a reserve report, its totals, the period and when it was published |
| `finance.countersign/1` | the issuer's accountant | names exactly one reserve record |
| `finance.release/1` | a recording service | a fingerprint of a published data file, where it was fetched from, and when |
| `finance.gap/1` | the attestation service | an expected attestation or report did not arrive |

Amounts are integer cents. All records use canonical JSON, a SHA-256 content id and an
Ed25519 signature.

## Rules the verifier applies

- Every record is signed by the pinned key of the party it names.
- Every expected day has a holdings attestation or a signed gap record; attestations chain
  in order, so a re-issued or deleted day is caught.
- Stated holdings are compared with the token supply the verifier reads itself.
- A second reserve report for the same period is a revision and is shown as one; a report
  published after its deadline is late; a countersignature applies only to the version it
  names.
- A data file matches a recorded release only if its bytes are identical.

## Scope

Evidence tooling only. It never holds assets or moves money, and gives no investment,
legal or accounting advice. An attestation proves what a signer stated and when, not that
the statement is true; it does not replace an audit or an accountant's examination.

## License

Apache License 2.0. Copyright 2026 Embryo Space Inc. (DBA BSVKey).
