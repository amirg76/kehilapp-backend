/**
 * Admin publishing (integration).
 *
 * Two contracts live here:
 *
 *   - message bodies are capped at messageConstants.textMaxLength, and every
 *     message has an author taken from the token — never from the request body;
 *   - `visibility` is now settable through the API, but the members-only tier is
 *     an admin act. A non-admin who EXPLICITLY asks for a tier they may not set
 *     gets a 403 — never a 200 over a silently downgraded message. Omitting the
 *     field is still fine and yields 'public' on create, no change on update,
 *     which is what the resident UI does: it never sends the field.
 *
 * Posts are plain JSON: POST/PATCH /api/messages carry upload.single('file'),
 * but multer passes a non-multipart request straight through to express.json.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import Message from '../apps/messages/dataAccess/messageModel.js';
import { updateMessageInDb } from '../apps/messages/dataAccess/messageRepository.js';
import { messageConstants } from '../config/validationConstants.js';

const PASSWORD = 'correct-horse-battery';
const ADMIN_EMAIL = 'admin@test.example.com';
const MEMBER_EMAIL = 'member@test.example.com';

let admin;
let member;

beforeEach(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4); // low cost: this is a test
  // approved: true — both fixtures stand for admitted members of the community;
  // the admin-approval gate has its own suite (approval.int.test.js).
  [admin, member] = await User.create([
    { name: 'Admin Test', email: ADMIN_EMAIL, role: 'admin', passwordHash, emailVerified: true, approved: true },
    { name: 'Member Test', email: MEMBER_EMAIL, role: 'member', passwordHash, emailVerified: true, approved: true },
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

  // The create path had a cap test; the update path did not, so dropping .max()
  // from the update schema used to go unnoticed by the suite.
  it('rejects an over-cap body on update with 400', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const created = await createAs(token, { categoryId: 'cat-1', title: 'short for now' });
    expect(created.status).toBe(200);

    const res = await request(app)
      .patch(`/api/messages/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        categoryId: 'cat-1',
        title: 'short for now',
        text: 'a'.repeat(messageConstants.textMaxLength + 1),
      });

    expect(res.status).toBe(400);
    const saved = await Message.findById(created.body._id).lean();
    expect(saved.text).toBeUndefined();
  });
});

describe('message model invariants', () => {
  // The HTTP tests all go through the controller, which always supplies a
  // senderId from the token — so none of them notice if the model stops
  // requiring one. Seeds and scripts write straight through the model.
  it('refuses to save a message with no senderId', async () => {
    await expect(Message.create({ categoryId: 'cat-1', title: 'no author' })).rejects.toThrow();

    // The schema's post('save') error middleware rewrites a ValidationError into
    // a generic AppError, which loses the field name. validateSync runs the same
    // validators without that middleware, so the offending path is still visible.
    const validationError = new Message({ categoryId: 'cat-1', title: 'no author' }).validateSync();
    expect(validationError.name).toBe('ValidationError');
    expect(Object.keys(validationError.errors)).toContain('senderId');
  });

  it('refuses to save an over-cap body written straight through the model', async () => {
    await expect(
      Message.create({
        categoryId: 'cat-1',
        title: 'over cap',
        senderId: String(member._id),
        text: 'a'.repeat(messageConstants.textMaxLength + 1),
      }),
    ).rejects.toThrow();
    expect(await Message.countDocuments()).toBe(0);
  });

  it('refuses an unknown visibility value on a direct repository update', async () => {
    const saved = await Message.create({
      categoryId: 'cat-1',
      title: 'valid tier',
      senderId: String(member._id),
    });

    await expect(
      updateMessageInDb(String(saved._id), { visibility: 'ARBITRARY-TIER' }, { isAdmin: true }),
    ).rejects.toThrow();

    const reread = await Message.findById(saved._id).lean();
    expect(reread.visibility).toBe('public');
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

  it('rejects a senderId supplied in the request body', async () => {
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

  it('refuses a member asking for the members tier with 403', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await createAs(token, {
      categoryId: 'cat-1',
      title: 'member reaching up',
      visibility: 'members',
    });

    // A silent downgrade used to return 200 while storing the message public —
    // an API client had no way to learn its "members only" post was world-readable.
    expect(res.status).toBe(403);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('lets a member ask explicitly for public', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await createAs(token, {
      categoryId: 'cat-1',
      title: 'explicitly public',
      visibility: 'public',
    });

    expect(res.status).toBe(200);
    const saved = await Message.findOne({ title: 'explicitly public' }).lean();
    expect(saved.visibility).toBe('public');
  });

  it('defaults to public when a member omits visibility', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await createAs(token, { categoryId: 'cat-1', title: 'member no tier' });

    expect(res.status).toBe(200);
    const saved = await Message.findOne({ title: 'member no tier' }).lean();
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
  it('refuses a member flipping their own message to members-only with 403', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const created = await createAs(token, { categoryId: 'cat-1', title: 'mine to keep public' });
    expect(created.status).toBe(200);

    const res = await request(app)
      .patch(`/api/messages/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: 'cat-1', title: 'mine to keep public', visibility: 'members' });

    expect(res.status).toBe(403);
    const saved = await Message.findById(created.body._id).lean();
    expect(saved.visibility).toBe('public');
  });

  // On update even an explicit 'public' is refused: the caller may not be the
  // one who chose the current tier, so honouring it could be a downgrade.
  it('refuses a member sending an explicit public on update with 403', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const created = await createAs(token, { categoryId: 'cat-1', title: 'already public' });
    expect(created.status).toBe(200);

    const res = await request(app)
      .patch(`/api/messages/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: 'cat-1', title: 'already public', visibility: 'public' });

    expect(res.status).toBe(403);
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

  // An ordinary title edit must not touch the tier. Without these two, a change
  // that made the update path resolve to 'public' instead of "leave it alone"
  // would quietly publish members-only content and the suite would stay green.
  it('leaves the stored tier alone when an admin edits only the title', async () => {
    const adminToken = await loginAs(ADMIN_EMAIL);
    const created = await createAs(adminToken, {
      categoryId: 'cat-1',
      title: 'members tier',
      visibility: 'members',
    });
    expect(created.body.visibility).toBe('members');

    const res = await request(app)
      .patch(`/api/messages/${created.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryId: 'cat-1', title: 'retitled' });

    expect(res.status).toBe(200);
    const saved = await Message.findById(created.body._id).lean();
    expect(saved.title).toBe('retitled');
    expect(saved.visibility).toBe('members');
  });

  it('leaves the stored tier alone when the non-admin owner edits only the title', async () => {
    const memberToken = await loginAs(MEMBER_EMAIL);
    const created = await createAs(memberToken, { categoryId: 'cat-1', title: 'owned by member' });
    expect(created.status).toBe(200);

    // Only an admin can put it in the members tier in the first place.
    const adminToken = await loginAs(ADMIN_EMAIL);
    const promoted = await request(app)
      .patch(`/api/messages/${created.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryId: 'cat-1', title: 'owned by member', visibility: 'members' });
    expect(promoted.status).toBe(200);

    const res = await request(app)
      .patch(`/api/messages/${created.body._id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ categoryId: 'cat-1', title: 'owner retitled' });

    expect(res.status).toBe(200);
    const saved = await Message.findById(created.body._id).lean();
    expect(saved.title).toBe('owner retitled');
    expect(saved.visibility).toBe('members');
  });
});
