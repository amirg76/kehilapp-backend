/**
 * The verification token must not travel in an API response body (integration).
 *
 * WHAT THIS IS GUARDING. `POST /api/auth/register` used to return the raw
 * email-verification token whenever no real mail had been delivered — and the
 * default mailer transport delivers nothing, so that condition was always true.
 * Registering with someone else's address therefore returned the token that
 * verifies that address. `POST /api/auth/resend-verification` was worse: it takes
 * an address and nothing else, so no registration was even needed.
 *
 * The exposure is now two explicit conditions (config/environment.js), and the
 * suite-wide default in jest.setup.env.cjs turns it ON because the other
 * registration tests drive the flow end to end and need the token back. So every
 * test here turns it OFF first — the closed state is the one that ships, and it
 * is the one nothing else in the suite covers.
 *
 * These assert the full key set of each response rather than the absence of two
 * named fields. A leak that comes back under a new name is the same leak, and
 * `expect(body.verificationToken).toBeUndefined()` passes cheerfully through it.
 */
import request from 'supertest';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';

const FLAG = 'EXPOSE_VERIFICATION_LINK';
const EMAIL = 'stranger@test.example.com';
const PASSWORD = 'correct-horse-battery';

const register = (body) => request(app).post('/api/auth/register').send(body);
const resend = (email) => request(app).post('/api/auth/resend-verification').send({ email });

let flagBefore;

beforeAll(async () => {
  await User.init();
});

beforeEach(() => {
  flagBefore = process.env[FLAG];
  process.env[FLAG] = '';
});

afterEach(async () => {
  process.env[FLAG] = flagBefore;
  await User.deleteMany({});
});

describe('POST /api/auth/register with the exposure flag off', () => {
  it('returns no verification token, no link, and no other field beyond the six it documents', async () => {
    const res = await register({ email: EMAIL, password: PASSWORD, name: 'Stranger' });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'approved',
      'email',
      'emailDelivered',
      'emailVerified',
      'id',
      'role',
    ]);
    // Belt and braces against a field that carries the token inside another value.
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });

  it('still mints a usable token — it is withheld from the caller, not skipped', async () => {
    await register({ email: EMAIL, password: PASSWORD });

    // The account is verifiable; the only party who can verify it is whoever
    // receives the email. That is the entire point of the change.
    // Both fields are `select: false` in the schema, so both have to be asked for
    // by name — a query that names only one gets `undefined` for the other and
    // reads exactly like a field the code forgot to write.
    const stored = await User.findOne({ email: EMAIL }).select('+emailVerificationTokenHash +emailVerificationExpires');
    expect(stored.emailVerificationTokenHash).toBeTruthy();
    expect(stored.emailVerificationExpires.getTime()).toBeGreaterThan(Date.now());
    expect(stored.emailVerified).toBe(false);
  });

  it('reports that no mail was delivered, so the UI can say so instead of "check your inbox"', async () => {
    const res = await register({ email: EMAIL, password: PASSWORD });

    // No EMAIL_PROVIDER is configured under jest (jest.setup.env.cjs pins it
    // empty), so the log transport ran and nothing left the process.
    expect(res.body.emailDelivered).toBe(false);
  });

  it('is gated by the flag and not by the mailer: the same request returns the token with it on', async () => {
    // Same endpoint, same body, same absent mail provider — only the flag differs.
    // Without this contrast a passing test above could just mean the route broke.
    process.env[FLAG] = 'true';
    const exposed = await register({ email: EMAIL, password: PASSWORD });
    expect(exposed.body.verificationToken).toBeTruthy();
    expect(exposed.body.verificationLink).toContain(exposed.body.verificationToken);

    await User.deleteMany({});

    process.env[FLAG] = '';
    const withheld = await register({ email: EMAIL, password: PASSWORD });
    expect(withheld.body.verificationToken).toBeUndefined();
    expect(withheld.body.verificationLink).toBeUndefined();
  });
});

describe('POST /api/auth/resend-verification with the exposure flag off', () => {
  it('returns no token for an address that exists and is unverified', async () => {
    await register({ email: EMAIL, password: PASSWORD });

    const res = await resend(EMAIL);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'ok']);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });

  it('answers a registered and an unregistered address identically', async () => {
    await register({ email: EMAIL, password: PASSWORD });

    const known = await resend(EMAIL);
    const unknown = await resend('nobody-here@test.example.com');

    // Uniformity is why this endpoint does NOT report emailDelivered the way
    // register does: delivery is only attempted for an address that exists and is
    // unverified, so the boolean would answer the question the uniform response
    // exists to refuse.
    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
  });
});
