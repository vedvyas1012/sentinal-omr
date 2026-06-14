# Threat Model

This document states precisely what the system defends against, what it does
not, and the trust boundaries — so the integrity claims can be judged honestly.

## Asset

The integrity of each student's answer sheet between the moment it is scanned at
the exam center (the **edge**) and the moment it is re-scanned at the central
processing **hub**.

## What we defend against

### 1. Physical tampering of the sheet in transit
A filled bubble erased, or a new bubble filled, after the edge scan and before
hub processing.

**Defense.** Both sides detect answers with the *same* `gridAnalyzer` and build
the *same* canonical data string. A confident disagreement on any question
(`match_status = 'flagged'`) means the marks changed in transit. Identical code
on both sides means a clean sheet always matches, so a confident mismatch is
genuine evidence, not detector drift.

### 2. Alteration of the edge record at rest (database tampering)
An attacker with database access edits the stored edge answers to match a
tampered physical sheet, hiding the tampering.

**Defense.** Each edge record is signed at scan time with an **Ed25519** private
key held by the issuing authority. The hub verifies the signature over the
stored data string before comparing. Editing the record without the private key
invalidates the signature → `flagged`. This is what makes the signature
meaningful: it binds the answers to the authority, so equality alone can no
longer be forged. (Verified end-to-end: a DB edit that would otherwise read as
"matched" is correctly flagged.)

### 3. Independent auditability
An auditor should not have to trust the server or database to confirm a record
is authentic.

**Defense.** The public key is exposed at `GET /api/dashboard/public-key`. Any
party can verify `(data string, signature)` offline.

### 4. False-positive floods from OCR noise
Phone camera and document scanner read the same sheet slightly differently;
naive exact-match would flag legitimate sheets.

**Defense.** Each read carries a per-question **confidence**. A difference is
only `flagged` as tampering when *both* sides read the bubble confidently.
Otherwise it is `review` — surfaced to a human, never auto-accused. Unreadable
edge scans are rejected at capture time (quality gate) rather than stored.

### 5. Session and access threats
- Invigilator sessions are short-lived JWTs (30 min) with a server-enforced
  20-minute scan window.
- Socket rooms are authorized per client; the pre-auth login flow uses a
  one-time, server-granted room so a request cannot be intercepted.
- The hub agent authenticates with a machine API key, not a human login.
- Every route enforces role; passwords are bcrypt (12 rounds).

## What we do NOT defend against (honest boundaries)

- **Collusion at the edge scan.** The edge record is the source of truth. If the
  invigilator and student collude to record fraudulent answers *at scan time*,
  hub verification will still "match" — because the fraud is upstream of the
  protected channel. Mitigating this needs proctoring/biometrics, out of scope.
- **Loss/substitution of the whole sheet.** We detect altered marks on a sheet
  that reaches the hub, not a sheet swapped for a different one bearing the same
  QR. Sequential custody/chain-of-custody controls are complementary.
- **Compromise of the signing private key.** If the private key leaks, records
  can be forged. In production the key belongs in an HSM or is injected via
  `SIGNING_PRIVATE_KEY`; the dev keypair on disk is for demonstration only.
- **Server compromise.** A fully compromised server can sign anything. The
  signature protects the database-at-rest and transit boundary, not a rooted host.

## Trust boundaries

| Boundary | Trusted? | Protection |
|---|---|---|
| Exam-time scan (edge) | Trusted as source of truth | Quality gate; signed at creation |
| Edge → Hub (physical transit) | **Untrusted** | Same-algorithm re-scan + hash |
| Database at rest | **Untrusted** for edge records | Ed25519 signature verification |
| Signing private key | Trusted | File `0600` in dev; HSM/env in prod |
| Hub scan agent | Authenticated | Machine API key |

## Production hardening (acknowledged gaps)

- Move signing to an HSM or the issuing authority's device; inject the key via
  env, never commit it.
- Per-center signing keys with rotation.
- Add chain-of-custody tracking (sheet count reconciliation per center).
- Calibrate confidence thresholds against real scanner/camera data.
