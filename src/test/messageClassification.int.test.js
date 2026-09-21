/**
 * AI category + urgency suggestion (integration).
 *
 * The Anthropic SDK is mocked at the module boundary. Nothing in this suite may
 * reach the network: a test that calls the real API is a test that costs money
 * every time CI runs, fails whenever the key is absent, and returns a different
 * answer each time — none of which is a test.
 *
 * What is NOT mocked is everything this feature is actually about: the category
 * list comes from the real (in-memory) database, and the checks that decide
 * whether the model's answer is allowed out of the server run for real. Mocking
 * the classifier service itself would have left exactly those unexercised.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';

// `mock`-prefixed so babel-plugin-jest-hoist allows the factory below to close
// over it, and referenced lazily inside the constructor rather than in the
// factory body: the factory runs while app.js is being imported, which is before
// this declaration has been evaluated.
const mockMessagesCreate = jest.fn();
// Every options object the service hands to `new Anthropic(...)`. Captured
// because two of those options are cost controls that nothing else can observe:
// a retry happens inside the SDK, so a service built with the SDK's default
// `maxRetries` would pass every other test in this file while quietly billing up
// to three times per click.
const anthropicConstructorOptions = [];

jest.mock('@anthropic-ai/sdk', () => {
  // The typed error classes are taken from the real SDK rather than re-declared.
  // categoryClassifier's error chain is `instanceof` against these exact
  // classes, so a hand-written stand-in would make that chain silently stop
  // matching and the test would be checking nothing.
  const actual = jest.requireActual('@anthropic-ai/sdk');
  const ActualAnthropic = actual.default || actual;

  class MockAnthropic {
    constructor(options) {
      anthropicConstructorOptions.push(options);
      this.messages = { create: (...args) => mockMessagesCreate(...args) };
    }
  }
  MockAnthropic.AuthenticationError = ActualAnthropic.AuthenticationError;
  MockAnthropic.RateLimitError = ActualAnthropic.RateLimitError;
  MockAnthropic.APIError = ActualAnthropic.APIError;

  return { __esModule: true, default: MockAnthropic };
});

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import Category from '../apps/categories/dataAccess/categoryModel.js';
import Message from '../apps/messages/dataAccess/messageModel.js';

const PASSWORD = 'correct-horse-battery';
const ADMIN_EMAIL = 'admin@test.example.com';
const PENDING_EMAIL = 'pending@test.example.com';
const MEMBER_EMAIL = 'member@test.example.com';

const SECURITY_TITLE = 'ביטחון';
const CULTURE_TITLE = 'תרבות';

let securityCategory;

/** A well-formed answer, as the API returns it: typed blocks, not a string. */
const modelAnswer = (answer, { stopReason = 'end_turn', leadingBlock = null } = {}) => ({
  stop_reason: stopReason,
  content: [
    // A block before the text one is the normal case this response shape exists
    // for; keeping it here means content[0] would be wrong in every test, not
    // just in a test written to catch it.
    ...(leadingBlock ? [leadingBlock] : []),
    { type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) },
  ],
});

beforeEach(async () => {
  // An absent key turns the whole feature off (that path has its own test
  // below), so every other test here has to start from "configured". Set per
  // test rather than in jest.setup.env.cjs: a placeholder key left globally in
  // place would hide a missing guard in some other suite.
  process.env.ANTHROPIC_API_KEY = 'test-key-never-sent-anywhere';
  mockMessagesCreate.mockReset();
  anthropicConstructorOptions.length = 0;

  const passwordHash = await bcrypt.hash(PASSWORD, 4); // low cost: this is a test
  await User.create([
    { name: 'Admin Test', email: ADMIN_EMAIL, role: 'admin', passwordHash, emailVerified: true, approved: true },
    // Verified email, no admin approval yet — the caller requireApproved exists for.
    { name: 'Pending Test', email: PENDING_EMAIL, role: 'member', passwordHash, emailVerified: true, approved: false },
    // An ordinary resident in good standing: verified AND admitted. Every guard
    // on this route except the role check says yes to this account, which is
    // exactly why its absence from this file let a real hole through review.
    { name: 'Member Test', email: MEMBER_EMAIL, role: 'member', passwordHash, emailVerified: true, approved: true },
  ]);

  [securityCategory] = await Category.create([
    { title: SECURITY_TITLE, icon: 'shield', attachmentKey: 'k-security', categoryColor: '#c00' },
    { title: CULTURE_TITLE, icon: 'music', attachmentKey: 'k-culture', categoryColor: '#0c0' },
  ]);
});

afterEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await User.deleteMany({});
  await Category.deleteMany({});
  await Message.deleteMany({});
});

const loginAs = async (email) => {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token;
};

const classifyAs = async (token, body) =>
  request(app).post('/api/messages/classify').set('Authorization', `Bearer ${token}`).send(body);

describe('POST /api/messages/classify — guards', () => {
  it('refuses a caller whose token is not valid with 401', async () => {
    const res = await classifyAs('not-a-real-token', { title: 'נסיון' });

    expect(res.status).toBe(401);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('refuses a caller carrying no credentials at all', async () => {
    // 403, not 401, and that is the app-wide CSRF gate answering rather than
    // `auth`: csrfProtection runs in app.js ahead of every router and exempts
    // only requests that authenticate by Bearer header. A request with neither
    // header nor cookie never reaches this route. Asserted as 403 because that
    // is what the server actually does — writing 401 here would be a test of
    // what the guard order is imagined to be.
    const res = await request(app).post('/api/messages/classify').send({ title: 'נסיון' });

    expect(res.status).toBe(403);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('refuses a signed-in but unapproved caller with 403', async () => {
    const token = await loginAs(PENDING_EMAIL);
    const res = await classifyAs(token, { title: 'נסיון' });

    // Not 401: they proved who they are. And nothing was spent on them —
    // a billed call behind an unadmitted account is the reason the guards run
    // ahead of the limiter and the controller.
    expect(res.status).toBe(403);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('refuses an APPROVED member with 403 and spends nothing', async () => {
    // The regression this route actually shipped with. Approval is not the
    // question here — this account has it — and neither is authentication. The
    // question is who may spend money, and the answer is admins only. A live run
    // against the running server returned 200 to exactly this kind of account
    // before `requireRole('admin')` was added, so this test is a record of a
    // real failure and not a hypothetical one.
    const token = await loginAs(MEMBER_EMAIL);
    const res = await classifyAs(token, { title: 'נסיון', text: 'טקסט' });

    expect(res.status).toBe(403);
    // The assertion that makes this test about MONEY rather than about a status
    // code: the model must not have been reached at all.
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('rejects a body that would not be storable, before calling the model', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: '' });

    expect(res.status).toBe(400);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/messages/classify — feature switched off', () => {
  it('answers 503 when no API key is configured, and calls nothing', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    delete process.env.ANTHROPIC_API_KEY;

    const res = await classifyAs(token, { title: 'הודעה' });

    expect(res.status).toBe(503);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('treats an empty-string key as no key', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    process.env.ANTHROPIC_API_KEY = '   ';

    const res = await classifyAs(token, { title: 'הודעה' });

    expect(res.status).toBe(503);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('leaves the rest of the message API working with the feature off', async () => {
    // The point of degrading rather than refusing to boot: the board keeps
    // working, the admin just types the category in themselves.
    const token = await loginAs(ADMIN_EMAIL);
    delete process.env.ANTHROPIC_API_KEY;

    const created = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: String(securityCategory._id), title: 'ידנית' });

    expect(created.status).toBe(200);
  });
});

describe('POST /api/messages/classify — a usable answer', () => {
  it('maps the returned title to the real category id', async () => {
    mockMessagesCreate.mockResolvedValue(
      modelAnswer(
        { categoryTitle: SECURITY_TITLE, urgency: 'urgent', reason: 'מדובר בסגירת כביש להיום.' },
        { leadingBlock: { type: 'thinking', thinking: '' } },
      ),
    );

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'סגירת כביש', text: 'הכביש הראשי סגור היום' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      categoryId: String(securityCategory._id),
      categoryTitle: SECURITY_TITLE,
      urgency: 'urgent',
      reason: 'מדובר בסגירת כביש להיום.',
    });
    // The id is a real one, not merely a plausible string.
    expect(await Category.findById(res.body.categoryId).lean()).not.toBeNull();
  });

  it('accepts a title that differs only in surrounding whitespace', async () => {
    mockMessagesCreate.mockResolvedValue(
      modelAnswer({ categoryTitle: `  ${SECURITY_TITLE} `, urgency: 'routine', reason: 'עדכון שגרתי.' }),
    );

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'עדכון' });

    expect(res.status).toBe(200);
    expect(res.body.categoryId).toBe(String(securityCategory._id));
    // The stored title comes back, not the one the model wrote.
    expect(res.body.categoryTitle).toBe(SECURITY_TITLE);
  });

  it('builds the client with retries off and a timeout, so one click is one billed call', async () => {
    // Not a style assertion. The SDK's own defaults are `maxRetries: 2` and a
    // ten-minute timeout, and both are wrong behind a limiter that counts
    // requests this server RECEIVED: a retried call is billed again without the
    // limiter ever seeing it, so the enforced budget silently becomes a third of
    // what it claims. Pinned here because nothing observable from the outside —
    // status code, response body, call count — changes when these regress.
    mockMessagesCreate.mockResolvedValue(
      modelAnswer({ categoryTitle: CULTURE_TITLE, urgency: 'routine', reason: 'תרבות.' }),
    );

    const token = await loginAs(ADMIN_EMAIL);
    await classifyAs(token, { title: 'ערב שירה' });

    expect(anthropicConstructorOptions).toHaveLength(1);
    expect(anthropicConstructorOptions[0]).toMatchObject({ maxRetries: 0 });
    expect(anthropicConstructorOptions[0].timeout).toBeGreaterThan(0);
    expect(anthropicConstructorOptions[0].timeout).toBeLessThanOrEqual(60_000);
    // The key is never handed to the constructor: the SDK reads it from the
    // environment, so it lives in one fewer stack frame.
    expect(anthropicConstructorOptions[0]).not.toHaveProperty('apiKey');
  });

  it('suggests without storing anything', async () => {
    mockMessagesCreate.mockResolvedValue(
      modelAnswer({ categoryTitle: CULTURE_TITLE, urgency: 'routine', reason: 'הודעה על אירוע.' }),
    );

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'ערב שירה' });

    expect(res.status).toBe(200);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('sends the live category list and the documented request shape', async () => {
    mockMessagesCreate.mockResolvedValue(
      modelAnswer({ categoryTitle: CULTURE_TITLE, urgency: 'routine', reason: 'תרבות.' }),
    );

    const token = await loginAs(ADMIN_EMAIL);
    await classifyAs(token, { title: 'ערב שירה' });

    const [params] = mockMessagesCreate.mock.calls[0];

    // The category titles reach the model from the database, so a category added
    // in the admin panel is classifiable without a code change. If this ever
    // regresses to a hard-coded list, nothing else in the suite would notice.
    expect(params.system).toContain(SECURITY_TITLE);
    expect(params.system).toContain(CULTURE_TITLE);

    // Structured output is what makes the parse deterministic; effort sits
    // INSIDE output_config next to it, not at the top level.
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.output_config.format.schema.additionalProperties).toBe(false);
    expect(params.output_config.effort).toBe('low');

    // Parameters this model removed. Sending one is a 400 from the API, which in
    // production means the feature is simply broken — so their absence is
    // asserted here rather than left to a comment.
    expect(params.thinking).toBeUndefined();
    expect(params.budget_tokens).toBeUndefined();
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.messages.every((message) => message.role === 'user')).toBe(true);

    expect(params.model).toBe('claude-opus-5');
  });

  it('honours ANTHROPIC_MODEL when one is configured', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-5';
    mockMessagesCreate.mockResolvedValue(
      modelAnswer({ categoryTitle: CULTURE_TITLE, urgency: 'routine', reason: 'תרבות.' }),
    );

    try {
      const token = await loginAs(ADMIN_EMAIL);
      await classifyAs(token, { title: 'ערב שירה' });
      expect(mockMessagesCreate.mock.calls[0][0].model).toBe('claude-sonnet-5');
    } finally {
      delete process.env.ANTHROPIC_MODEL;
    }
  });
});

describe('POST /api/messages/classify — an answer the server refuses', () => {
  it('rejects a category title that does not exist, and returns no id at all', async () => {
    // The failure this whole check exists for: a title that reads perfectly and
    // is not on the board. Taking the model's word for it would mean answering
    // with an id the server made up.
    mockMessagesCreate.mockResolvedValue(
      modelAnswer({ categoryTitle: 'ביטחון ובטיחות', urgency: 'urgent', reason: 'סיכון בטיחותי.' }),
    );

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'מפגע' });

    expect(res.status).toBe(502);
    expect(res.body.categoryId).toBeUndefined();
    expect(res.body.urgency).toBeUndefined();
  });

  it('rejects an urgency the enum does not contain', async () => {
    mockMessagesCreate.mockResolvedValue(
      modelAnswer({ categoryTitle: SECURITY_TITLE, urgency: 'critical', reason: 'דחוף מאוד.' }),
    );

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'מפגע' });

    expect(res.status).toBe(502);
    expect(res.body.urgency).toBeUndefined();
  });

  it('treats stop_reason refusal as a failure instead of parsing the content', async () => {
    // HTTP 200 with a refusal, and a body that would parse cleanly. A reader
    // that goes straight to content would return this as a successful
    // classification; stop_reason has to be read first.
    mockMessagesCreate.mockResolvedValue(
      modelAnswer(
        { categoryTitle: SECURITY_TITLE, urgency: 'urgent', reason: 'לא אמור להיקרא.' },
        {
          stopReason: 'refusal',
        },
      ),
    );

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'מפגע' });

    expect(res.status).toBe(502);
    expect(res.body.categoryId).toBeUndefined();
    expect(res.body.error).toMatch(/declined/i);
  });

  it('rejects an answer that is not JSON', async () => {
    mockMessagesCreate.mockResolvedValue(modelAnswer('I think this belongs in security.'));

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'מפגע' });

    expect(res.status).toBe(502);
    expect(res.body.categoryId).toBeUndefined();
  });

  it('answers 503 when the board has no categories to choose from', async () => {
    await Category.deleteMany({});

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'מפגע' });

    expect(res.status).toBe(503);
    // Refused before the billed call, not after rejecting whatever came back.
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/messages/classify — upstream failures', () => {
  it('reports a rejected API key as 503, not as a caller error', async () => {
    const Anthropic = jest.requireActual('@anthropic-ai/sdk');
    const ActualAnthropic = Anthropic.default || Anthropic;
    mockMessagesCreate.mockRejectedValue(
      new ActualAnthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', undefined),
    );

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'מפגע' });

    // The admin can do nothing about a bad key; it is this server's problem.
    expect(res.status).toBe(503);
  });

  it('passes an upstream rate limit through as 429', async () => {
    const Anthropic = jest.requireActual('@anthropic-ai/sdk');
    const ActualAnthropic = Anthropic.default || Anthropic;
    mockMessagesCreate.mockRejectedValue(
      new ActualAnthropic.RateLimitError(429, { type: 'error' }, 'rate limited', undefined),
    );

    const token = await loginAs(ADMIN_EMAIL);
    const res = await classifyAs(token, { title: 'מפגע' });

    expect(res.status).toBe(429);
  });
});
