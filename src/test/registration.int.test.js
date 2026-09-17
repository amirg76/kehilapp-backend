/**
 * Self-registration + email verification (integration).
 *
 * The whole flow end to end against a real (in-memory) MongoDB:
 *   register → account exists but is unverified
 *   login before verify → 403 (credentials fine, address unconfirmed)
 *   verify-email with the emailed token → account verified
 *   login after verify → 200 with a token
 *   register the same email again → 409
 *   resend-verification → 200, issues a fresh usable token
 *
 * With no EMAIL_PROVIDER configured the mailer only logs the link and returns it,
 * so the register/resend responses carry the verification token for the test to
 * use — exactly the dev/test affordance the mailer is built to provide.
 */
import request from 'supertest';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';

const EMAIL = 'newcomer@test.example.com';
const PASSWORD = 'correct-horse-battery';

// Ensure the unique index on email is actually built before the duplicate-email
// case runs — otherwise a second insert could slip through and the 409 that the
// index produces would never fire.
beforeAll(async () => {
  await User.init();
});

afterEach(async () => {
  await User.deleteMany({});
});

const register = (body) => request(app).post('/api/auth/register').send(body);
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

describe('self-registration', () => {
  it('registers a new member as unverified and never stores the raw token', async () => {
    const res = await register({ email: EMAIL, password: PASSWORD, name: 'Newcomer' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('member');
    expect(res.body.emailVerified).toBe(false);
    expect(res.body.verificationToken).toBeTruthy(); // dev/test convenience

    // The DB holds only the sha256 of the token, never the token itself.
    const stored = await User.findOne({ email: EMAIL }).select('+passwordHash +emailVerificationTokenHash');
    expect(stored.emailVerified).toBe(false);
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.emailVerificationTokenHash).toBeTruthy();
    expect(stored.emailVerificationTokenHash).not.toBe(res.body.verificationToken);
  });

  it('rejects login before verification with 403', async () => {
    await register({ email: EMAIL, password: PASSWORD });
    const res = await login(EMAIL, PASSWORD);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verif/i); // a clear, actionable message
  });

  it('verifies the email and then allows login', async () => {
    const reg = await register({ email: EMAIL, password: PASSWORD });
    const token = reg.body.verificationToken;

    const verify = await request(app).post('/api/auth/verify-email').send({ token });
    expect(verify.status).toBe(200);
    expect(verify.body.emailVerified).toBe(true);

    const res = await login(EMAIL, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects an invalid verification token with 400', async () => {
    await register({ email: EMAIL, password: PASSWORD });
    const res = await request(app).post('/api/auth/verify-email').send({ token: 'not-a-real-token' });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate email with 409', async () => {
    const first = await register({ email: EMAIL, password: PASSWORD });
    expect(first.status).toBe(201);

    const second = await register({ email: EMAIL, password: PASSWORD });
    expect(second.status).toBe(409);
  });

  it('rejects a too-short password with 400 before touching the database', async () => {
    const res = await register({ email: EMAIL, password: 'short' });
    expect(res.status).toBe(400);
    expect(await User.countDocuments({ email: EMAIL })).toBe(0);
  });

  it('resend-verification issues a fresh token that verifies the account', async () => {
    await register({ email: EMAIL, password: PASSWORD });

    const resend = await request(app).post('/api/auth/resend-verification').send({ email: EMAIL });
    expect(resend.status).toBe(200);
    expect(resend.body.verificationToken).toBeTruthy();

    const verify = await request(app).post('/api/auth/verify-email').send({ token: resend.body.verificationToken });
    expect(verify.status).toBe(200);

    const res = await login(EMAIL, PASSWORD);
    expect(res.status).toBe(200);
  });

  it('resend-verification is a uniform 200 for an unknown address (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/resend-verification').send({ email: 'ghost@test.example.com' });
    expect(res.status).toBe(200);
    expect(res.body.verificationToken).toBeUndefined(); // nothing minted for a non-user
  });
});
