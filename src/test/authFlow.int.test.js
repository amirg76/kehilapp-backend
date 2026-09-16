/**
 * Behavior tests: the full authentication + authorization story, end to end
 * against a real (in-memory) MongoDB.
 *
 * The unit gates prove the guards are WIRED. These prove the guards WORK:
 * a real user logs in, gets a real token, and the API answers 200/401/403
 * for the right people in the right places.
 *
 * Named *.int.test.js so the jest `int` project picks it up and provides the
 * in-memory MongoDB (see jest.config.cjs).
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import Message from '../apps/messages/dataAccess/messageModel.js';

const PASSWORD = 'correct-horse-battery';

let admin;
let member;

beforeEach(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4); // low cost: this is a test
  // emailVerified: true — login now refuses unverified accounts, and these
  // fixtures exist to exercise the authenticated paths, not the sign-up flow.
  [admin, member] = await User.create([
    { name: 'Admin Test', email: 'admin@test.example.com', role: 'admin', passwordHash, emailVerified: true },
    { name: 'Member Test', email: 'member@test.example.com', role: 'member', passwordHash, emailVerified: true },
  ]);
});

afterEach(async () => {
  await User.deleteMany({});
  await Message.deleteMany({});
});

const loginAs = async (email) => {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeDefined();
  return res.body.token;
};

describe('login', () => {
  it('issues a token for valid credentials and never echoes the hash', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'member@test.example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('member@test.example.com');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects a wrong password and a wrong email with the same 401', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'member@test.example.com', password: 'wrong-wrong-wrong' });
    const wrongEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.example.com', password: PASSWORD });

    // Same status, same body — the response must not reveal which half failed.
    expect(wrongPassword.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(wrongEmail.body);
  });

  it('rejects a malformed body before it reaches the database', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('protected routes', () => {
  // GET /api/messages is public now; use the user directory, which stays protected.
  it('turn away callers without a token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('turn away a syntactically valid but forged token', async () => {
    const res = await request(app).get('/api/users').set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.forged');
    expect(res.status).toBe(401);
  });

  it('answer a signed-in member', async () => {
    const token = await loginAs('member@test.example.com');
    const res = await request(app).get('/api/messages').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('authorization', () => {
  it('lets a member read but not destroy', async () => {
    const token = await loginAs('member@test.example.com');

    const read = await request(app).get('/api/messages').set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);

    // The endpoint that was once open to the entire internet.
    const destroy = await request(app).delete('/api/messages').set('Authorization', `Bearer ${token}`);
    expect(destroy.status).toBe(403);
  });

  it('lets an admin do what a member cannot', async () => {
    await Message.create({ categoryId: 'cat-1', title: 'to be deleted', text: 'x', senderId: String(admin._id) });
    const token = await loginAs('admin@test.example.com');

    const destroy = await request(app).delete('/api/messages').set('Authorization', `Bearer ${token}`);
    expect([200, 204]).toContain(destroy.status);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('keeps the member directory admin-only', async () => {
    const memberToken = await loginAs('member@test.example.com');
    const adminToken = await loginAs('admin@test.example.com');

    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${memberToken}`)).status).toBe(403);
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
  });
});

describe('messages', () => {
  it('stamps a new message with the sender from the token, not the body', async () => {
    const token = await loginAs('member@test.example.com');

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .field('categoryId', 'cat-1')
      .field('title', 'שלום מקהילת הדגמה');

    expect(res.status).toBe(200);

    const saved = await Message.findOne({ title: 'שלום מקהילת הדגמה' }).lean();
    expect(saved).not.toBeNull();
    expect(saved.senderId).toBe(String(member._id));
  });

  it('caps a page and reports the total in headers', async () => {
    const docs = Array.from({ length: 7 }, (_, i) => ({
      categoryId: 'cat-1',
      title: `הודעה ${i + 1}`,
      text: 'תוכן',
      senderId: String(member._id),
    }));
    await Message.create(docs);

    const token = await loginAs('member@test.example.com');
    const res = await request(app).get('/api/messages?limit=3&page=1').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.headers['x-total-count']).toBe('7');
    expect(res.headers['x-page-size']).toBe('3');
  });

  it('treats a hostile search term as literal text', async () => {
    const token = await loginAs('member@test.example.com');

    // Before escaping, this pattern caused catastrophic regex backtracking.
    const res = await request(app)
      .get('/api/messages')
      .query({ searchTerm: '(a+)+$' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('resilience (crash-on-error regression)', () => {
  it('answers 400, not a dead process, on a malformed login body', async () => {
    // This exact request used to reach process.exit(1) via the error handler.
    const res = await request(app).post('/api/auth/login').send({ email: 'x' });
    expect(res.status).toBe(400);
  });

  it('answers 400 on a malformed ObjectId instead of crashing', async () => {
    const token = await loginAs('member@test.example.com');
    // A CastError used to be treated as non-operational → process.exit.
    const res = await request(app).get('/api/messages/not-a-valid-object-id').set('Authorization', `Bearer ${token}`);
    expect([400, 404]).toContain(res.status);
  });
});

describe('write authorization (IDOR regression)', () => {
  it("stops a member from editing another user's message", async () => {
    // A message owned by the admin.
    const victim = await Message.create({
      categoryId: 'cat-1',
      title: 'owned by admin',
      text: 'original',
      senderId: String(admin._id),
    });

    const memberToken = await loginAs('member@test.example.com');
    const res = await request(app)
      .patch(`/api/messages/${victim._id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .field('categoryId', 'cat-1')
      .field('title', 'defaced by member');

    // Not authorized to touch someone else's message.
    expect(res.status).toBe(404);

    const after = await Message.findById(victim._id).lean();
    expect(after.title).toBe('owned by admin'); // unchanged
  });

  it('lets a member edit their own message', async () => {
    const memberToken = await loginAs('member@test.example.com');
    const mine = await Message.create({
      categoryId: 'cat-1',
      title: 'mine',
      text: 'original',
      senderId: String(member._id),
    });

    const res = await request(app)
      .patch(`/api/messages/${mine._id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .field('categoryId', 'cat-1')
      .field('title', 'edited by me');

    expect(res.status).toBe(200);
    expect((await Message.findById(mine._id).lean()).title).toBe('edited by me');
  });
});

describe('user PII exposure (regression)', () => {
  it("hides another user's email from a plain member", async () => {
    const memberToken = await loginAs('member@test.example.com');
    // member asking for the ADMIN's record
    const res = await request(app).get(`/api/users/${admin._id}`).set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBeDefined(); // name is public
    expect(res.body.email).toBeUndefined(); // email is not
    expect(res.body.role).toBeUndefined();
  });

  it('shows a member their own full record', async () => {
    const memberToken = await loginAs('member@test.example.com');
    const res = await request(app).get(`/api/users/${member._id}`).set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('member@test.example.com');
  });

  it("lets an admin see anyone's full record", async () => {
    const adminToken = await loginAs('admin@test.example.com');
    const res = await request(app).get(`/api/users/${member._id}`).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('member@test.example.com');
  });
});
