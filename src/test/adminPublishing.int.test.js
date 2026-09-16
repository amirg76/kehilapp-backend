/**
 * Admin publishing (integration).
 *
 * Two contracts live here:
 *
 *   - message bodies are capped at messageConstants.textMaxLength, and every
 *     message has an author taken from the token — never from the request body;
 *   - `visibility` is now settable through the API, but the members-only tier is
 *     an admin act. A non-admin asking for 'members' silently gets 'public' on
 *     create and no visibility change at all on update, because the resident UI
 *     never offers the choice.
 *
 * Posts are plain JSON: POST/PATCH /api/messages carry upload.single('file'),
 * but multer passes a non-multipart request straight through to express.json.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import Message from '../apps/messages/dataAccess/messageModel.js';
import { messageConstants } from '../config/validationConstants.js';

const PASSWORD = 'correct-horse-battery';
const ADMIN_EMAIL = 'admin@test.example.com';
const MEMBER_EMAIL = 'member@test.example.com';

let admin;
let member;

beforeEach(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4); // low cost: this is a test
  [admin, member] = await User.create([
    { name: 'Admin Test', email: ADMIN_EMAIL, role: 'admin', passwordHash, emailVerified: true },
    { name: 'Member Test', email: MEMBER_EMAIL, role: 'member', passwordHash, emailVerified: true },
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

const createAs = async (token, body) =>
  request(app).post('/api/messages').set('Authorization', `Bearer ${token}`).send(body);

describe('message body length', () => {
  it('rejects a body longer than the cap with 400', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await createAs(token, {
      categoryId: 'cat-1',
      title: 'too long',
      text: 'a'.repeat(messageConstants.textMaxLength + 1),
    });

    expect(res.status).toBe(400);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('accepts a body of exactly the cap', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await createAs(token, {
      categoryId: 'cat-1',
      title: 'exactly at cap',
      text: 'a'.repeat(messageConstants.textMaxLength),
    });

    expect(res.status).toBe(200);
    const saved = await Message.findOne({ title: 'exactly at cap' }).lean();
    expect(saved.text).toHaveLength(messageConstants.textMaxLength);
  });
});

describe('message authorship', () => {
  it('stores the authenticated caller as senderId', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await createAs(token, { categoryId: 'cat-1', title: 'authored by me' });

    expect(res.status).toBe(200);
    const saved = await Message.findOne({ title: 'authored by me' }).lean();
    expect(saved.senderId).toBe(String(member._id));
  });

  it('ignores a senderId supplied in the request body', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await createAs(token, {
      categoryId: 'cat-1',
      title: 'forged author',
      senderId: String(admin._id),
    });

    // The create schema has no senderId key, so the forged attribution is
    // refused at the door and never reaches the database either way.
    expect(res.status).toBe(400);
    expect(await Message.countDocuments({ senderId: String(admin._id) })).toBe(0);
  });
});

describe('visibility on create', () => {
  it('lets an admin publish a members-only message that anonymous callers cannot read', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    const res = await createAs(token, {
      categoryId: 'cat-1',
      title: 'הודעת חברים',
      text: '(תוכן לחברים בלבד)',
      visibility: 'members',
    });

    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe('members');

    // 404, never 403 — a 403 would confirm the message exists.
    const anonymous = await request(app).get(`/api/messages/${res.body._id}`);
    expect(anonymous.status).toBe(404);
  });

  it('downgrades a member asking for the members tier to public', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await createAs(token, {
      categoryId: 'cat-1',
      title: 'member reaching up',
      visibility: 'members',
    });

    expect(res.status).toBe(200);
    const saved = await Message.findOne({ title: 'member reaching up' }).lean();
    expect(saved.visibility).toBe('public');
  });

  it('defaults to public when visibility is omitted', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    const res = await createAs(token, { categoryId: 'cat-1', title: 'no tier asked' });

    expect(res.status).toBe(200);
    const saved = await Message.findOne({ title: 'no tier asked' }).lean();
    expect(saved.visibility).toBe('public');
  });

  it('rejects an unknown visibility value with 400', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    const res = await createAs(token, { categoryId: 'cat-1', title: 'bad tier', visibility: 'secret' });

    expect(res.status).toBe(400);
    expect(await Message.countDocuments()).toBe(0);
  });
});

describe('visibility on update', () => {
  it('does not let a member flip their own message to members-only', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const created = await createAs(token, { categoryId: 'cat-1', title: 'mine to keep public' });
    expect(created.status).toBe(200);

    const res = await request(app)
      .patch(`/api/messages/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: 'cat-1', title: 'mine to keep public', visibility: 'members' });

    expect(res.status).toBe(200);
    const saved = await Message.findById(created.body._id).lean();
    expect(saved.visibility).toBe('public'); // silently unchanged
  });

  it('lets an admin flip a message to members-only', async () => {
    const adminToken = await loginAs(ADMIN_EMAIL);
    const created = await createAs(adminToken, { categoryId: 'cat-1', title: 'to be promoted' });
    expect(created.status).toBe(200);
    expect(created.body.visibility).toBe('public');

    const res = await request(app)
      .patch(`/api/messages/${created.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryId: 'cat-1', title: 'to be promoted', visibility: 'members' });

    expect(res.status).toBe(200);
    const saved = await Message.findById(created.body._id).lean();
    expect(saved.visibility).toBe('members');
  });
});
