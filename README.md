# NEET Secure OMR Workflow System

A full-stack examination-integrity platform that detects tampering of paper OMR
sheets between the exam hall and the central processing hub.

An invigilator scans each answer sheet at the exam center, producing a
tamper-evident SHA-256 **edge hash**. After the physical sheets are transported
to the hub and re-scanned, the server recomputes a **hub hash** from the scanned
image **using the exact same detection algorithm**. If the two hashes disagree,
the sheet was altered in transit — it is flagged for audit and grading is
blocked. Because both sides run identical code, identical marks always produce
identical hashes, so a mismatch is genuine evidence of tampering rather than
algorithm drift.

## Architecture

```
            EXAM CENTER (edge)                         HUB (central scan)
 ┌──────────────────────────────────┐      ┌────────────────────────────────────┐
 │  Invigilator app (Expo / mobile) │      │   Document scanner saves images     │
 │   • auto-detect student QR       │      │             │                       │
 │   • auto-capture sheet photo     │      │             ▼                       │
 │   • crop+resize to 800x1000      │      │   hub-agent watcher (watch/ folder) │
 └───────────────┬──────────────────┘      │   • POST image + API key            │
                 │ POST /api/scan/submit    └───────────────┬────────────────────┘
                 ▼  (Bearer JWT)                            │ POST /api/hub/verify-image
 ┌──────────────────────────────────┐                      ▼
 │  Server OMR analysis             │      ┌────────────────────────────────────┐
 │   • gridAnalyzer → answers+conf  │      │  Server OMR analysis (SAME code)   │
 │   • buildDataString              │      │   • decode QR → studentId          │
 │   • SHA-256 → edgeHash           │      │   • gridAnalyzer → answers+conf    │
 │   • Ed25519 sign(dataString)     │      │   • verify edge signature          │
 └───────────────┬──────────────────┘      │   • confidence-gated answer diff   │
                 │ store (signed)           └───────────────┬────────────────────┘
                 ▼                                          │ matched / review / flagged
        ┌──────────────────────────────────────────────────▼──────────┐
        │                    PostgreSQL                                │
        │   users · login_requests · scan_sessions · omr_records ·     │
        │   audit_log                                                  │
        └───────────────┬──────────────────────────────────────────────┘
                         │
        MATCHED ──► match_status = 'matched'  → authorized for grading
        REVIEW  ──► match_status = 'review'   → ambiguous read, human adjudication
        FLAGGED ──► match_status = 'flagged'  → audit_log insert, grading blocked
                         │
                 ┌───────▼────────────┐        ┌──────────────────────┐
                 │  Official dashboard │        │  Hub monitoring panel │
                 │  (read-only audit)  │        │  (read-only status)   │
                 └─────────────────────┘        └──────────────────────┘
```

Real-time login approval (invigilator → moderator) runs over Socket.IO, with
per-socket room authorization so a client can only join its own approval room.

## Components

| Component | Stack | Role |
|---|---|---|
| **Server** | Express, PostgreSQL, Socket.IO, sharp | API, OMR analysis, hashing, auth |
| **Web client** | React, Vite, Tailwind | Moderator, hub monitoring, official dashboard, login |
| **Invigilator app** | Expo / React Native | Automatic QR-driven sheet scanning at the exam hall |
| **Hub agent** | Node (zero deps) | Watches a folder and auto-uploads scanned sheet images |

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 1. Database
```bash
createdb neet_omr
```

### 2. Environment
```bash
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET, and HUB_API_KEY
```

### 3. Server + web client
```bash
npm install
npm --prefix client install

# Dev (API + web with hot reload)
npm run dev

# Or separately
npm run server               # API on :3001
npm --prefix client run dev  # Web on :5173
```
Migrations run and demo users are seeded automatically on startup.

### 4. Invigilator app (mobile)
```bash
cd invigilator-app
npm install
npx expo start
```
Set `API_URL` / `SOCKET_URL` in `invigilator-app/src/config.js` to your
machine's LAN IP so a physical device can reach the server.

### 5. Hub agent (on the scanner PC)
```bash
cd hub-agent
npm install
cp .env.example .env   # set SERVER_URL and HUB_API_KEY (must match the server)
node watcher.js
```
Point the document scanner's "scan to folder" output at `hub-agent/watch/`.
Each `.jpg` / `.png` is uploaded automatically and moved to `processed/` or
`failed/`.

## Role Guide

| Role | Username | Password | What they do |
|------|----------|----------|--------------|
| **Moderator** | `mod1` | `mod123` | Approves/denies invigilator logins in real time |
| **Invigilator** | `inv1` | `inv123` | Requests approval, then scans sheets within a 20-min window |
| **Invigilator** | `inv2` | `inv456` | Same as inv1 |
| **Hub Operator** | `hub1` | `hub123` | Monitors auto-submitted verification results (read-only) |
| **Official** | `official1` | `off123` | Reviews the audit dashboard of flagged mismatches |

### Invigilator login flow
1. Invigilator enters credentials in the app → "Request Login Approval".
2. Moderator receives a real-time notification → clicks Approve.
3. The app receives `login_approved` over Socket.IO and claims a JWT.
4. **0–20 min**: scanning window open; countdown visible.
5. **20 min**: window locked; the server rejects further submissions.
6. **30 min**: JWT expires; the app returns to the login screen.

### Scanning (fully automatic)
The app detects the sheet's QR code, counts down, captures, crops/resizes the
image to 800×1000, and submits — no manual entry. The server detects the filled
bubbles and records the edge hash.

## Security

See [THREAT_MODEL.md](THREAT_MODEL.md) for what the system does and does not
defend against.

- **Same algorithm on both sides** — edge and hub call the identical
  `gridAnalyzer`, so a confident disagreement is real tampering, not detector
  drift.
- **Ed25519 signatures** — every edge record is signed at scan time. The hub
  verifies the signature before comparing, so altering a record in the database
  to hide tampering is detected (it invalidates the signature). The public key
  (`GET /api/dashboard/public-key`) lets officials verify records independently
  of the database.
- **Confidence-gated matching** — each read carries a per-question confidence.
  A difference is flagged as tampering only when both sides read it confidently;
  ambiguous reads go to **review**, not a false accusation. Unreadable edge
  scans are rejected at capture (quality gate).
- **No image storage** — sheet images are processed as in-memory buffers and
  never written to disk.
- **JWT auth** — httpOnly cookies for web clients, Bearer tokens for the native
  app; 30-minute invigilator sessions with server-side window enforcement.
- **Socket room authorization** — clients may only join rooms their JWT permits;
  the pre-auth login flow uses a one-time, server-granted room.
- **Machine API key** — the hub agent authenticates with `HUB_API_KEY`; no human
  login is involved in submission.
- **Role-based API guards** — every route checks the JWT role; wrong role → 403.
- **bcrypt passwords** — 12 salt rounds.
- **Audit trail** — every flag is written to `audit_log` with the divergence
  detail and a console `[FLAGGED]` line.
- **CORS** — all origins allowed in development (web uses cookies, native uses
  Bearer); disabled in production.

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | moderator / hub_operator / official | Direct login |
| POST | `/api/auth/request-login` | — | Invigilator approval request |
| POST | `/api/auth/resolve-login/:id` | moderator | Approve or deny a request |
| GET | `/api/auth/claim-token` | — (post-approval) | Issue invigilator JWT |
| GET | `/api/auth/pending-requests` | moderator | Pending requests for the center |
| GET | `/api/auth/me` | any | Current user |
| POST | `/api/auth/logout` | any | Clear session |
| POST | `/api/scan/analyze-omr` | invigilator | Detect answers (preview, no write) |
| POST | `/api/scan/submit` | invigilator | Submit a scanned sheet → edge hash |
| GET | `/api/scan/session-info` | invigilator | Scan-window status |
| GET | `/api/scan/my-scans` | invigilator | This session's scans |
| POST | `/api/hub/verify-image` | `HUB_API_KEY` | Upload scanned sheet → hub hash + compare |
| GET | `/api/hub/records` | hub_operator | Processed records (monitoring) |
| GET | `/api/hub/stats` | hub_operator | Processed / matched / flagged / pending counts |
| GET | `/api/dashboard/flagged` | official | All flagged audit records |
| GET | `/api/dashboard/stats` | official | Totals by match status |
| GET | `/api/dashboard/public-key` | official | Ed25519 public key for independent verification |
| GET | `/omr-sheet?studentId=<id>` | — | Printable OMR sheet with student QR |
