/**
 * "Forgot password" (25.11.2026): forgot-password emails a one-hour, one-use
 * link to a VERIFIED account only, and answers every address the same, before
 * anything is looked up or sent. reset-password sets the new password from
 * that link and ends every session signed before it.
 *
 * The mail provider is simulated as slow (a fake fetch that answers after
 * providerDelayMs), the way the real one is, so a path that waits for it shows
 * up in the timing. The link is read from the email, as its owner would.
 *
 * Named *.int.test.js so the jest `int` project provides the in-memory MongoDB.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import Message from '../apps/messages/dataAccess/messageModel.js';
import logger from '../services/logger.js';
import { mailSendStore, mailRecipientStore } from '../middlewares/rateLimit.js';

const PASSWORD = 'old-password-12345';
const NEW_PASSWORD = 'new-password-67890';
const SUBJECT_RESET = 'איפוס הסיסמה שלך — קהילאפ';
const MEMBER = 'member@test.example.com';
const PENDING = 'pending@test.example.com';

jest.setTimeout(120000);

const forgot = (email) => request(app).post('/api/auth/forgot-password').send({ email });
const reset = (token, password) => request(app).post('/api/auth/reset-password').send({ token, password });
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const me = (token) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

const waitFor = async (check, what, timeoutMs = 10000) => {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

const tokenFromEmail = (mail) => {
  const match = /reset-password\?token=([^"&<\s]+)/.exec(mail.html);
  if (!match) throw new Error('no reset link in the email');
  return decodeURIComponent(match[1]);
};

let envBefore;
let fetchBefore;
let providerDelayMs = 0;
let sent;

beforeAll(async () => {
  await User.init();
});

beforeEach(async () => {
  mailSendStore.resetAll();
  mailRecipientStore.resetAll();
  envBefore = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EXPOSE_VERIFICATION_LINK: process.env.EXPOSE_VERIFICATION_LINK,
  };
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 'test-key-not-real';
  process.env.EXPOSE_VERIFICATION_LINK = '';
  sent = [];
  fetchBefore = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    const { to, subject, html } = JSON.parse(init.body);
    await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
    sent.push({ to, subject, html });
    return { ok: true, status: 200 };
  });
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await User.create([
    { name: 'Member', email: MEMBER, role: 'member', passwordHash, emailVerified: true },
    {
      name: 'Pending',
      email: PENDING,
      role: 'member',
      passwordHash,
      emailVerified: false,
      emailVerificationTokenHash: 'pending-token-hash',
      emailVerificationExpires: new Date(Date.now() + 60000),
    },
  ]);
});

afterEach(async () => {
  jest.restoreAllMocks();
  global.fetch = fetchBefore;
  providerDelayMs = 0;
  for (const [k, v] of Object.entries(envBefore)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await User.deleteMany({});
  await Message.deleteMany({});
});

describe('forgot-password', () => {
  it('answers a verified, a pending and an unknown address the same, before any email', async () => {
    providerDelayMs = 3000;
    const answers = [];
    for (const email of [MEMBER, PENDING, 'nobody@test.example.com']) {
      const start = Date.now();
      const res = await forgot(email);
      answers.push({ status: res.status, body: res.body, ms: Date.now() - start });
    }
    for (const a of answers) {
      expect(a.status).toBe(200);
      expect(a.body).toEqual(answers[0].body);
      // Waiting for the provider would take at least 3000 ms.
      expect(a.ms).toBeLessThan(1500);
    }
    expect(JSON.stringify(answers[0].body)).not.toMatch(/token/i);
  });

  it('emails a reset link to a verified account only', async () => {
    for (const email of [MEMBER, PENDING, 'nobody@test.example.com']) await forgot(email);
    await waitFor(() => sent.length >= 1, 'the reset email');
    await settle();
    expect(sent.map(({ to, subject }) => ({ to, subject }))).toEqual([{ to: MEMBER, subject: SUBJECT_RESET }]);
    const stored = await User.findOne({ email: MEMBER }).select('+passwordResetTokenHash');
    // Only the hash is stored, never the emailed token.
    expect(stored.passwordResetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.passwordResetTokenHash).not.toBe(tokenFromEmail(sent[0]));
  });

  it('logs a failure of the work done after the answer instead of crashing', async () => {
    jest.spyOn(User, 'updateOne').mockRejectedValueOnce(new Error('database down'));
    const error = jest.spyOn(logger, 'error');
    expect((await forgot(MEMBER)).status).toBe(200);
    await waitFor(
      () => error.mock.calls.some(([line]) => String(line).includes('forgot-password failed')),
      'the logged failure',
    );
    expect(sent).toHaveLength(0);
  });

  it('carries the per-address mail cap: 3 an hour, then 429', async () => {
    for (let i = 0; i < 3; i++) expect((await forgot(MEMBER)).status).toBe(200);
    expect((await forgot(MEMBER)).status).toBe(429);
  });
});

describe('reset-password', () => {
  const requestLink = async () => {
    await forgot(MEMBER);
    await waitFor(() => sent.length === 1, 'the reset email');
    return tokenFromEmail(sent[0]);
  };

  it('sets the new password from the emailed link', async () => {
    const token = await requestLink();
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);
    expect((await login(MEMBER, PASSWORD)).status).toBe(401);
    expect((await login(MEMBER, NEW_PASSWORD)).status).toBe(200);
  });

  it('works once: the same link a second time is refused', async () => {
    const token = await requestLink();
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);
    expect((await reset(token, 'third-password-111')).status).toBe(400);
    expect((await login(MEMBER, NEW_PASSWORD)).status).toBe(200);
  });

  it('refuses an expired link and leaves the password alone', async () => {
    const token = await requestLink();
    await User.updateOne({ email: MEMBER }, { $set: { passwordResetExpires: new Date(Date.now() - 1000) } });
    expect((await reset(token, NEW_PASSWORD)).status).toBe(400);
    expect((await login(MEMBER, PASSWORD)).status).toBe(200);
  });

  it('refuses a made-up token and a too-short password', async () => {
    const token = await requestLink();
    expect((await reset('f'.repeat(64), NEW_PASSWORD)).status).toBe(400);
    expect((await reset(token, 'short')).status).toBe(400);
    // Neither spent the real link.
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);
  });

  it('ends every session signed before the reset, and the new login works', async () => {
    const before = (await login(MEMBER, PASSWORD)).body.token;
    expect((await me(before)).status).toBe(200);

    const token = await requestLink();
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);

    expect((await me(before)).status).toBe(401);
    const after = (await login(MEMBER, NEW_PASSWORD)).body.token;
    expect((await me(after)).status).toBe(200);
  });

  it('ends an old session on the public board too: no members-only posts after the reset', async () => {
    // The security review's finding (25.11.2026): GET /api/messages uses
    // optionalAuth, which did not check the password version, so a stolen
    // session kept reading members-only posts after the owner's reset.
    const member = await User.findOneAndUpdate({ email: MEMBER }, { $set: { approved: true } }, { new: true });
    await Message.create({
      categoryId: 'cat-1',
      senderId: String(member._id),
      title: 'MEMBERS-ONLY-SECRET',
      visibility: 'members',
    });
    const board = (token) => request(app).get('/api/messages').set('Authorization', `Bearer ${token}`);
    const before = (await login(MEMBER, PASSWORD)).body.token;
    expect(JSON.stringify((await board(before)).body)).toContain('MEMBERS-ONLY-SECRET');

    const token = await requestLink();
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);

    const stale = await board(before);
    expect(stale.status).toBe(200); // the board stays public: anonymous, not 401
    expect(JSON.stringify(stale.body)).not.toContain('MEMBERS-ONLY-SECRET');
    const after = (await login(MEMBER, NEW_PASSWORD)).body.token;
    expect(JSON.stringify((await board(after)).body)).toContain('MEMBERS-ONLY-SECRET');
  });

  it('a link stored for an account cannot be used once that account is not verified', async () => {
    // Defence in depth: the write itself requires a verified account.
    const token = await requestLink();
    await User.updateOne({ email: MEMBER }, { $set: { emailVerified: false } });
    expect((await reset(token, NEW_PASSWORD)).status).toBe(400);
  });
});
