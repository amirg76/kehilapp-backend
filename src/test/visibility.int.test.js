/**
 * Content visibility tiers (integration).
 *
 * The community board is public, but a message may be marked visibility:'members'
 * to withhold it from anonymous callers. These tests pin the contract:
 *
 *   - an anonymous caller sees ONLY public messages, in the list and by id;
 *   - a signed-in caller sees BOTH public and members-only;
 *   - a members-only message fetched by id returns 404 to an anonymous caller
 *     (never 403 — a 403 would confirm the message exists) and 200 to a member.
 *
 * Uses optionalAuth on the read routes: no token means anonymous, not 401.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import Message from '../apps/messages/dataAccess/messageModel.js';

const PASSWORD = 'correct-horse-battery';

let publicMsg;
let membersMsg;

beforeEach(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await User.create({
    name: 'Member Test',
    email: 'member@test.example.com',
    role: 'member',
    passwordHash,
    emailVerified: true,
  });

  [publicMsg, membersMsg] = await Message.create([
    { categoryId: 'cat-1', title: 'הודעה ציבורית', text: 'גלוי לכולם', visibility: 'public' },
    { categoryId: 'cat-1', title: 'הודעת חברים', text: '(תוכן לחברים בלבד)', visibility: 'members' },
  ]);
});

afterEach(async () => {
  await User.deleteMany({});
  await Message.deleteMany({});
});

const loginAs = async (email) => {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token;
};

describe('message visibility tiers', () => {
  it('anonymous list returns only public messages', async () => {
    const res = await request(app).get('/api/messages');

    expect(res.status).toBe(200);
    const titles = res.body.map((m) => m.title);
    expect(titles).toContain('הודעה ציבורית');
    expect(titles).not.toContain('הודעת חברים');
    expect(res.headers['x-total-count']).toBe('1'); // total is per-tier, not leaky
  });

  it('authenticated list returns both public and members-only messages', async () => {
    const token = await loginAs('member@test.example.com');
    const res = await request(app).get('/api/messages').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const titles = res.body.map((m) => m.title);
    expect(titles).toContain('הודעה ציבורית');
    expect(titles).toContain('הודעת חברים');
    expect(res.headers['x-total-count']).toBe('2');
  });

  it('a members-only message by id is 404 to an anonymous caller', async () => {
    const res = await request(app).get(`/api/messages/${membersMsg._id}`);
    expect(res.status).toBe(404); // never reveal its existence
  });

  it('a members-only message by id is 200 to a signed-in caller', async () => {
    const token = await loginAs('member@test.example.com');
    const res = await request(app).get(`/api/messages/${membersMsg._id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('הודעת חברים');
  });

  it('a public message by id stays readable without a token', async () => {
    const res = await request(app).get(`/api/messages/${publicMsg._id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('הודעה ציבורית');
  });
});
