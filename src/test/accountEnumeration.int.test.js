/**
 * Register and resend-verification must not tell a stranger which addresses
 * are registered (24.11.2026), must not let one caller make this server email
 * strangers without limit, and must not help anyone verify an account opened
 * in someone else's name.
 *
 * Before: register answered a taken address 409 and a new one 201, and
 * resend-verification waited for the mail provider only when the address was
 * registered and unverified. The live server sends real mail, so that wait was
 * hundreds of ms a stranger could read off the clock.
 *
 * The mail provider is simulated as slow (a fake fetch that answers after
 * providerDelayMs), the way the real one is, so a path that waits for it shows
 * up in the timing.
 *
 * Named *.int.test.js so the jest `int` project provides the in-memory MongoDB.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import logger from '../services/logger.js';
import { mailSendStore, mailRecipientStore } from '../middlewares/rateLimit.js';

const PASSWORD = 'correct-horse-battery';
const PROVIDER_DELAY_MS = 800;
const SUBJECT_VERIFY = 'אימות כתובת המייל שלך — קהילאפ';
const SUBJECT_EXISTS = 'כבר יש לך חשבון בקהילאפ';
const SUBJECT_PENDING = 'ניסיון הרשמה עם כתובת המייל שלך — קהילאפ';

jest.setTimeout(120000);

const register = (body) => request(app).post('/api/auth/register').send(body);
const resend = (email) => request(app).post('/api/auth/resend-verification').send({ email });

const timed = async (fn) => {
  const start = Date.now();
  const res = await fn();
  return { res, ms: Date.now() - start };
};

const waitFor = async (check, what, timeoutMs = 10000) => {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

let envBefore;
let fetchBefore;
let providerDelayMs = PROVIDER_DELAY_MS;
let sent; // what the fake provider was asked to send: [{ to, subject, html }]

beforeAll(async () => {
  await User.init();
});

beforeEach(() => {
  mailSendStore.resetAll();
  mailRecipientStore.resetAll();
  envBefore = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EXPOSE_VERIFICATION_LINK: process.env.EXPOSE_VERIFICATION_LINK,
  };
  // Production-like: a real provider, and no token in any response body.
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 'test-key-not-real';
  process.env.EXPOSE_VERIFICATION_LINK = '';
  sent = [];
  // jest's node environment has no global fetch, so the fake is put in place
  // by hand and removed after each test. The mailer reads only ok and status.
  fetchBefore = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    const { to, subject, html } = JSON.parse(init.body);
    await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
    sent.push({ to, subject, html });
    return { ok: true, status: 200 };
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  global.fetch = fetchBefore;
  providerDelayMs = PROVIDER_DELAY_MS;
  for (const [k, v] of Object.entries(envBefore)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await User.deleteMany({});
});

// An existing account. Unverified ones carry a token hash, as after register.
const existingMember = async (email, { verified = true } = {}) =>
  User.create({
    name: 'Existing',
    email,
    role: 'member',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailVerified: verified,
    emailVerificationTokenHash: verified ? undefined : 'old-token-hash',
    emailVerificationExpires: verified ? undefined : new Date(Date.now() + 60000),
  });

const sameAnswer = (a, b) => {
  expect(a.status).toBe(b.status);
  expect({ ...a.body, id: 'x', email: 'x' }).toEqual({ ...b.body, id: 'x', email: 'x' });
  expect(a.body.id).toMatch(/^[0-9a-f]{24}$/);
  expect(a.body.id).not.toBe(b.body.id);
};

describe('register', () => {
  it('answers a taken, verified address exactly like a new one', async () => {
    await existingMember('taken@test.example.com');

    const fresh = await register({ email: 'fresh@test.example.com', password: PASSWORD });
    const taken = await register({ email: 'taken@test.example.com', password: PASSWORD });

    expect(fresh.status).toBe(201);
    sameAnswer(taken, fresh);
    expect(taken.body.email).toBe('taken@test.example.com');
  });

  it('does not touch a verified account and tells its owner by email', async () => {
    const before = await existingMember('taken@test.example.com');
    const hashBefore = (await User.findById(before.id).select('+passwordHash')).passwordHash;

    await register({ email: 'taken@test.example.com', password: 'another-password-123', name: 'Intruder' });

    expect(await User.countDocuments({ email: 'taken@test.example.com' })).toBe(1);
    const after = await User.findById(before.id).select('+passwordHash');
    expect(after.passwordHash).toBe(hashBefore);
    expect(after.name).toBe('Existing');
    expect(sent.map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: 'taken@test.example.com', subject: SUBJECT_EXISTS },
    ]);
  });

  it('answers a taken, never-verified address like a new one, and sends a warning, not a link', async () => {
    // The account may have been opened by a stranger with the owner's address
    // and the stranger's password. A verification link here would invite the
    // owner to verify that account (security review, 24.11.2026).
    const before = await existingMember('pending@test.example.com', { verified: false });
    const hashBefore = (await User.findById(before.id).select('+passwordHash')).passwordHash;

    const fresh = await register({ email: 'fresh@test.example.com', password: PASSWORD });
    sent = [];
    const taken = await register({ email: 'pending@test.example.com', password: 'another-password-123', name: 'X' });

    sameAnswer(taken, fresh);
    const after = await User.findById(before.id).select(
      '+passwordHash +emailVerificationTokenHash +emailVerificationExpires',
    );
    expect(after.passwordHash).toBe(hashBefore);
    expect(after.name).toBe('Existing');
    expect(after.emailVerified).toBe(false);
    // The token is not re-minted: the earlier link (if the owner has one) still works.
    expect(after.emailVerificationTokenHash).toBe('old-token-hash');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('pending@test.example.com');
    expect(sent[0].subject).toBe(SUBJECT_PENDING);
    expect(sent[0].html).not.toMatch(/token=|verify-email/);
  });

  it('treats a differently-cased address as the same taken address', async () => {
    await existingMember('taken@test.example.com');

    const res = await register({ email: 'Taken@Test.Example.COM', password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('taken@test.example.com');
    expect(await User.countDocuments({})).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(['taken@test.example.com']);
  });

  it('takes about as long for a taken address as for a new one (both wait for one email)', async () => {
    await existingMember('taken@test.example.com');
    await existingMember('pending@test.example.com', { verified: false });
    // Longer than the cost-12 password hash both paths do first (about 800 ms
    // on a slow machine), so only a path that waits for the email can pass.
    providerDelayMs = 3000;
    const fresh = await timed(() => register({ email: 'fresh@test.example.com', password: PASSWORD }));
    const taken = await timed(() => register({ email: 'taken@test.example.com', password: PASSWORD }));
    const pending = await timed(() => register({ email: 'pending@test.example.com', password: PASSWORD }));
    expect(fresh.ms).toBeGreaterThanOrEqual(providerDelayMs);
    expect(taken.ms).toBeGreaterThanOrEqual(providerDelayMs);
    expect(pending.ms).toBeGreaterThanOrEqual(providerDelayMs);
  });

  it('still answers 500 when the database fails for a reason other than a taken address', async () => {
    jest.spyOn(User.prototype, 'save').mockRejectedValueOnce(new Error('database down'));
    const res = await register({ email: 'fresh@test.example.com', password: PASSWORD });
    expect(res.status).toBe(500);
    expect(await User.countDocuments({})).toBe(0);
  });
});

describe('resend-verification', () => {
  it('answers before the email is sent, so a pending account is not slower to answer', async () => {
    await existingMember('pending@test.example.com', { verified: false });
    providerDelayMs = 3000;

    const pending = await timed(() => resend('pending@test.example.com'));
    const unknown = await timed(() => resend('nobody@test.example.com'));

    expect(pending.res.status).toBe(200);
    expect(pending.res.body).toEqual(unknown.res.body);
    // The old code waited for the provider here: at least 3000 ms.
    expect(pending.ms).toBeLessThan(1500);

    // The email still goes out, after the answer.
    await waitFor(() => sent.length === 1, 'the background send');
    expect(sent[0]).toMatchObject({ to: 'pending@test.example.com', subject: SUBJECT_VERIFY });
  });

  it('logs a failure of the work done after the answer instead of crashing', async () => {
    await existingMember('pending@test.example.com', { verified: false });
    jest.spyOn(User.prototype, 'save').mockRejectedValueOnce(new Error('database down'));
    const error = jest.spyOn(logger, 'error');

    const res = await resend('pending@test.example.com');

    expect(res.status).toBe(200);
    await waitFor(
      () => error.mock.calls.some(([line]) => String(line).includes('resend-verification failed')),
      'the logged failure',
    );
    expect(sent).toHaveLength(0);
  });
});

describe('the mail caps', () => {
  beforeEach(() => {
    providerDelayMs = 0;
  });

  it('allows 3 emails an hour to one address, the same for a registered and an unknown one', async () => {
    await existingMember('pending@test.example.com', { verified: false });
    for (const email of ['pending@test.example.com', 'nobody@test.example.com']) {
      for (let i = 0; i < 3; i++) expect((await resend(email)).status).toBe(200);
      expect((await resend(email)).status).toBe(429);
    }
    // register and resend share the per-address count.
    expect((await register({ email: 'nobody@test.example.com', password: PASSWORD })).status).toBe(429);
  });

  it('allows 20 mail-sending requests an hour from one caller, then 429', async () => {
    for (let i = 0; i < 20; i++) expect((await resend(`person${i}@test.example.com`)).status).toBe(200);
    expect((await resend('person20@test.example.com')).status).toBe(429);
    expect((await register({ email: 'person21@test.example.com', password: PASSWORD })).status).toBe(429);
  });

  it('does not count a form rejected by validation (400), so typos do not use it up', async () => {
    // 5, more than the per-address cap of 3. (registerLimiter, which this file
    // does not reset, separately allows 20 failed forms an hour.)
    for (let i = 0; i < 5; i++) {
      expect((await register({ email: 'typo@test.example.com', password: 'short' })).status).toBe(400);
    }
    expect((await register({ email: 'typo@test.example.com', password: PASSWORD })).status).toBe(201);
  });

  it('does not let blocked mail requests lock the same caller out of verifying an email', async () => {
    // registerLimiter (20 failures an hour) also guards verify-email. Counting
    // the mail caps' 429s as failures would exhaust it for everyone behind the
    // caller's address.
    for (let i = 0; i < 25; i++) await resend('nobody@test.example.com');
    const verify = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'f'.repeat(64) });
    expect(verify.status).toBe(400);
    // Nor the per-caller budget: the 22 turned away for that one address never
    // reached it, so another address can still be served.
    expect((await resend('somebody-else@test.example.com')).status).toBe(200);
  });
});
