# Kehilapp — Backend API

[![CI](https://github.com/amirg76/kehilapp-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/amirg76/kehilapp-backend/actions/workflows/ci.yml)

REST API for **Kehilapp**, a community notice board built after October 7th for an
evacuated kibbutz. The community's WhatsApp groups had become an unreadable flood;
this sorts the same updates into browsable categories with search, attachments and
an urgency level.

Built as a pilot with a small volunteer team (developers, designers, a product
person), in collaboration with the AppleSeeds (Tapuach) nonprofit. Covered by
*Yediot HaNegev*.

**Live demo:** _coming soon — deployment in progress (see
[kehilapp-devops](https://github.com/amirg76/kehilapp-devops))._

> Part of a 4-repo system: **Backend (this repo)** ·
> [Resident app](https://github.com/amirg76/kehilapp-front) ·
> [Admin dashboard](https://github.com/amirg76/kehilapp-admin) ·
> [Deployment](https://github.com/amirg76/kehilapp-devops) (Terraform, Docker, Caddy + nginx, runbooks)

---

## What it does

- **Messages** — the board. Members read; approved members post, with an optional
  attachment (image/PDF, presigned S3 upload); admins edit anything and delete.
- **Categories** — the sorting. Admin-managed, each with an icon and a colour.
- **Users** — registration with email verification, then an **admin approval**
  step before the account can write. Two roles: `member` and `admin`.
- **AI suggestion** — `POST /api/messages/classify` asks a Claude model to
  *suggest* a category and urgency for a notice an admin is drafting. It never
  assigns anything; a human presses save.

## Tech stack

| | |
|---|---|
| Runtime | Node.js 20 · Express 4 (ES modules) |
| Database | MongoDB via Mongoose |
| Files | AWS S3, presigned URLs, download-only content disposition |
| Validation | Celebrate / Joi on every route |
| Auth | JWT in an **httpOnly cookie** + CSRF double-submit token; `Authorization: Bearer` still accepted for API clients |
| Email | Pluggable: log-only (default), Resend, or SMTP |
| AI | `@anthropic-ai/sdk`, structured JSON output, optional (503 when no key) |
| Tests | Jest 27 + Supertest; `mongodb-memory-server` for integration |
| Logging | Winston, injection-safe formatting |

## Things worth a second look

This started as a volunteer MVP whose auth middleware had been commented out
"temporarily" and shipped that way. Most of what follows exists so that cannot
happen again quietly.

**Auth model** — login sets two cookies: an httpOnly session cookie JavaScript
cannot read (so an XSS cannot lift the token) and a readable CSRF cookie the SPA
echoes in `X-CSRF-Token` on every write. The two are compared with
`crypto.timingSafeEqual`. `Secure` and `SameSite` are fail-closed: they only relax
when `NODE_ENV` names a *known* development environment, never when it is merely
"not production". (`src/config/cookies.js`, `src/middlewares/csrf.js`)

**RBAC + approval tiers** — three states, not two: signed-in, *approved* member,
admin. Email verification proves an address; approval is a human admin saying
"this person belongs here". Both `approved` and `role` are read from the database
on every request, not from the token, so a revocation takes effect immediately.
(`src/middlewares/requireApproved.js`, `requireRole.js`, [docs/06](docs/06-approval-and-admin-publishing.md))

**Rate limits that match the threat** — a broad API ceiling; a tight login limiter
that counts only failures; a separate, looser registration limiter (so a typo in a
sign-up form is not treated as a brute-force attempt); and a per-*account* limiter
on the AI endpoint, because every call there is a billed request. All of them key
on the client IP, so the number of trusted proxy hops is configuration
(`TRUST_PROXY_HOPS`, 0–5, default 1) and an invalid value refuses to boot — too few
hops puts the whole internet in one bucket, too many lets a caller forge their
address. (`src/middlewares/rateLimit.js`, `src/config/environment.js`)

**Email verification with a dev-only escape hatch** — the verification token can be
returned in the API response for local demos, but only when
`EXPOSE_VERIFICATION_LINK=true` **and** `NODE_ENV` is a known development value.
Setting the flag in production is not ignored; the server refuses to start and
says why. The link target (`APP_BASE_URL`) is validated at boot for the same
reason: a wrong value fails in a stranger's inbox days later, not here.
(`src/config/environment.js`, `src/services/mailer.js`)

**Refuses to guess** — an unrecognised `NODE_ENV`, a malformed `COOKIE_SECURE`,
`COOKIE_SAMESITE`, `TRUST_PROXY_HOPS` or `APP_BASE_URL` each stop the process with
a one-line explanation instead of booting into the wrong half of a security
branch. (`src/index.js`)

**AI endpoint, boxed in** — admin-only, behind approval, behind the per-account
limiter, with a JSON-schema structured output so the parser is deterministic and
an extra field cannot slip through. The model proposes; the server decides what is
allowed to leave. (`src/services/categoryClassifier.js`)

**Health probes** — `GET /healthz` (process up) and `GET /readyz` (Mongo
connected, else 503), unauthenticated by design and mounted *before* the rate
limiter so a monitor can never be throttled into a false outage.

**CI floor that blocks** (`.github/workflows/ci.yml`) — deterministic steps only,
no model in the loop:

1. **gitleaks** secret scan over the full history (shallow clones scan nothing and
   report "clean", so `fetch-depth: 0`).
2. **ESLint**, zero warnings allowed.
3. **Raw bidi control character check** (`scripts/no-raw-bidi-check.mjs`) — a
   raw U+202E in source reverses what a reviewer *sees* without changing what the
   engine *runs*; one shipped here in a test literal.
4. **Jest**, including three gate tests: every route carries the auth middleware
   unless explicitly allowlisted; every `DELETE` names a role; every write checks
   membership (`src/test/routeAuthGuard.test.js`), plus a test that helmet, the
   limiters and the Mongo sanitiser are still actually wired
   (`src/test/securityMiddleware.test.js`).
5. **`npm audit --omit=dev --audit-level=high`** on the dependencies that ship.
   Dev-tool advisories are reported but never block.

**CodeQL** runs the `security-extended` query pack on every push and weekly
(`.github/workflows/codeql.yml`). Three agent reviewers (security, architecture,
intent) comment on pull requests — they advise, they never gate. **Dependabot**
groups patch/minor npm bumps and all action bumps into one PR each.

Three vulnerabilities found during hardening — a one-request DoS, a write-IDOR and
an SVG-upload XSS — were fixed with regression tests. The user-directory endpoint
that handed every member's email to every other member was closed the same way.

## Tests

```
npx jest --selectProjects unit               # 10 suites, 162 tests, no database
npx jest --selectProjects int --runInBand    # 13 suites, 163 tests, in-memory MongoDB
```

325 tests, measured on 6 Oct 2026 (exit 0 on both). The split is deliberate: the
route-guard gate reads the Express router tree and never touches Mongo, so making
it wait on a database start-up was pure cost — and a slow gate is a skipped gate.

## Running it

```bash
npm install
cp .env.example .env            # fill in values (docs/05 explains each one)
node scripts/seedDemo.js        # demo data only — never real community content
npm run local
```

For a one-command local stack with a throwaway in-memory MongoDB, seeded demo
data and the real server process:

```bash
node scripts/live-stack.cjs
```

The full walkthrough, including every environment variable and the common
failure modes, is in [docs/05](docs/05-running-locally.md).

## Documentation

**The guides in [`docs/`](docs/README.md) are written in Hebrew**, for a reader
with no programming background — every term explained, every decision argued. A
short English map:

| Guide | What it covers |
|---|---|
| [00 — What is this](docs/00-what-is-this.md) | The problem, the three tiers, why text in MongoDB and files in S3 |
| [01 — Architecture](docs/01-architecture.md) | Feature slices (`apps/<feature>/{dataAccess,domain,entryPoints}`), centralised errors, health as a separate concern |
| [02 — Security](docs/02-security.md) | Authentication vs authorization, the request-pipeline defences, trust proxy, the deployment layer, the three fixed vulnerabilities, what is still open |
| [03 — Testing](docs/03-testing.md) | Unit vs integration, the gate tests and how each was proven to fail |
| [04 — User flows](docs/04-user-flows.md) | The full API map, who may do what, three end-to-end walkthroughs |
| [05 — Running locally](docs/05-running-locally.md) | Install, environment, seed, run, test, troubleshoot, maintenance scripts |
| [06 — Approval and admin publishing](docs/06-approval-and-admin-publishing.md) | Why verified is not approved, why `approved`/`role` come from the database, the environment guards |

## Project layout

```
src/
  app.js            Express app: middleware order, routers
  index.js          Boot guards, DB connect, graceful shutdown
  apps/             auth · users · messages · categories · health
    <feature>/      dataAccess (models, repositories) · domain (controllers) · entryPoints (routes, validation)
  middlewares/      auth · optionalAuth · requireApproved · requireRole · csrf · cors · rateLimit · multer
  services/         db · s3 · mailer · categoryClassifier · logger
  config/           environment · cookies · validationConstants
  errors/           AppError, centralised handlers
  test/             unit (*.test.js) and integration (*.int.test.js)
scripts/            seedDemo · live-stack · atlas-stack · approveExistingUsers · removeUserByEmail · no-raw-bidi-check
docs/               Hebrew guides (map above)
```

## License

MIT
