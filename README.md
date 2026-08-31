# Kehilapp — Backend API

REST API for **Kehilapp**, a platform built after October 7th to organize the daily flood of WhatsApp messages that overwhelmed an evacuated kibbutz community's groups — sorting updates into clear, browsable categories.

Built as a pilot with a small volunteer team (developers, designers, a product person), in collaboration with the AppleSeeds (Tapuach) nonprofit. The project was covered by *Yediot HaNegev*.

> Part of a 3-tier system: **Backend (this repo)** · [User App](https://github.com/amirg76/kehilapp-front) · [Admin Dashboard](https://github.com/amirg76/kehilapp-admin)

### Tech Stack
- **Runtime:** Node.js · Express
- **Database:** MongoDB (Mongoose)
- **Auth:** JWT (jsonwebtoken) — Bearer token, bcrypt-hashed passwords, role-based access
- **File storage:** AWS S3 (presigned URLs)
- **Validation:** Celebrate / Joi
- **Logging:** Winston
- **Config:** dotenv (secrets via environment variables)
- **Testing:** Jest + Supertest (unit + integration)

### Architecture
Modular structure — `apps/` (feature modules), `config/`, `services/`, `middlewares/`, `errors/` — with a clean separation of concerns and centralized error handling.

### Production hardening
Originally a volunteer-built pilot; the authentication middleware existed but had
been commented out during development, leaving every route open. It has since been
brought toward production standard:

- **Real JWT authentication** on every route (the login stub replaced with bcrypt + JWT)
- **Role-based authorization** (`member` / `admin`) on every destructive action
- **helmet**, rate limiting, NoSQL-injection sanitisation, origin-allowlisted CORS
- **Automated gates** — tests that fail CI if any route ships without an auth guard,
  or any destructive route without a role check
- **CI pipeline** — lint, tests, production dependency audit, secret scanning, CodeQL

Three vulnerabilities found during hardening (a one-request DoS, a write-IDOR, and an
SVG upload XSS) were fixed with regression tests. See the docs below for the full story.

### Documentation
Full beginner-friendly guides live in [`docs/`](docs/README.md) — architecture,
security, testing, user flows, and how to run it locally. Written to be readable
with no prior background.

### Running it
```bash
npm install
cp .env.example .env      # fill in values
node scripts/seedDemo.js  # demo data only — no real community content
npm run local
```
See [`docs/05-running-locally.md`](docs/05-running-locally.md) for the full walkthrough.
