/**
 * Admin approval of a member (integration).
 *
 * Verifying an email proves the caller owns that address. It does not prove they
 * belong to the kibbutz. So a verified account starts life as "pending": it can
 * log in normally, but it sees exactly what an anonymous visitor sees until an
 * admin admits it to the community.
 *
 * The contract pinned here:
 *
 *   - a fresh account reports approved:false on login and on GET /api/auth/me;
 *   - an unapproved member's reads are public-only, list and by id;
 *   - an unapproved member may not WRITE at all: reading is public, writing is
 *     membership;
 *   - role and approval are read from the user DOCUMENT on every request, so a
 *     demotion or a revocation bites immediately instead of waiting out the token;
 *   - revoking an admin is refused rather than answered with a 200 that takes
 *     nothing away;
 *   - approve/revoke are admin-only (403 for a member) and 404 for an unknown id;
 *   - an admin may not revoke themselves — a board with no approved admin is a
 *     locked board;
 *   - an unapproved member can still LOG IN (200). That is the product decision,
 *     not an oversight, and this test exists so nobody "fixes" it into a 403.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import Message from '../apps/messages/dataAccess/messageModel.js';

const PASSWORD = 'correct-horse-battery';
const ADMIN_EMAIL = 'approval-admin@test.example.com';
const MEMBER_EMAIL = 'approval-member@test.example.com';
const PENDING_EMAIL = 'approval-pending@test.example.com';

let admin;
let approvedMember;
let pendingMember;
let publicMsg;
let membersMsg;

beforeEach(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4); // low cost: this is a test
  [admin, approvedMember, pendingMember] = await User.create([
    {
      name: 'Approval Admin',
      email: ADMIN_EMAIL,
      role: 'admin',
      passwordHash,
      emailVerified: true,
      approved: true,
    },
    {
      name: 'Approved Member',
      email: MEMBER_EMAIL,
      role: 'member',
      passwordHash,
      emailVerified: true,
      approved: true,
    },
    // Verified but never admitted: the state this whole suite is about.
    {
      name: 'Pending Member',
      email: PENDING_EMAIL,
      role: 'member',
      passwordHash,
      emailVerified: true,
      approved: false,
    },
  ]);

  [publicMsg, membersMsg] = await Message.create([
    {
      categoryId: 'cat-1',
      title: 'הודעה ציבורית',
      text: 'גלוי לכולם',
      visibility: 'public',
      senderId: String(admin._id),
    },
    {
      categoryId: 'cat-1',
      title: 'הודעת חברים',
      text: '(תוכן לחברים בלבד)',
      visibility: 'members',
      senderId: String(admin._id),
    },
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

const listAs = (token) => request(app).get('/api/messages').set('Authorization', `Bearer ${token}`);

describe('approval state on the identity endpoints', () => {
  it('reports approved:false for a freshly registered and verified account', async () => {
    const email = 'brand-new@test.example.com';
    const reg = await request(app).post('/api/auth/register').send({ email, password: PASSWORD });
    expect(reg.status).toBe(201);
    expect(reg.body.approved).toBe(false);

    const verify = await request(app).post('/api/auth/verify-email').send({ token: reg.body.verificationToken });
    expect(verify.status).toBe(200);

    const loggedIn = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.user.approved).toBe(false);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${loggedIn.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.approved).toBe(false);
  });

  it('lets an unapproved but verified member log in (200, not 403)', async () => {
    // The product decision: a pending resident gets in and is shown a "waiting
    // for approval" banner by the resident app. Locking them out at the door
    // would leave them with nowhere to see that they are waiting at all.
    const res = await request(app).post('/api/auth/login').send({ email: PENDING_EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.approved).toBe(false);
  });
});

describe('what an unapproved member may read', () => {
  it('returns only the public message, and a public-only X-Total-Count', async () => {
    const token = await loginAs(PENDING_EMAIL);
    const res = await listAs(token);

    expect(res.status).toBe(200);
    const titles = res.body.map((m) => m.title);
    expect(titles).toContain('הודעה ציבורית');
    expect(titles).not.toContain('הודעת חברים');
    expect(res.headers['x-total-count']).toBe('1'); // the count must not leak the hidden tier either
  });

  it('answers 404 for a members-only message fetched by id', async () => {
    const token = await loginAs(PENDING_EMAIL);
    const res = await request(app).get(`/api/messages/${membersMsg._id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404); // 404, never 403 — a 403 would confirm it exists
  });

  it('still serves a public message by id', async () => {
    const token = await loginAs(PENDING_EMAIL);
    const res = await request(app).get(`/api/messages/${publicMsg._id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('הודעה ציבורית');
  });
});

describe('who may approve', () => {
  it('refuses a member calling approve on someone else with 403', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await request(app)
      .patch(`/api/users/${pendingMember._id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(403);
    const reread = await User.findById(pendingMember._id).lean();
    expect(reread.approved).toBe(false);
  });

  it('refuses to approve an unverified account, and leaves it unapproved', async () => {
    // Verifying an email proves the address; approving is the separate human
    // decision that its holder belongs here. Admitting an UNverified account
    // would mean the "pending" queue (emailVerified && !approved, see the
    // admin dashboard's home tile) could contain an approved-but-unverified
    // account — a state that queue is defined to never produce.
    const unverified = await User.create({
      name: 'Unverified Signup',
      email: 'approval-unverified@test.example.com',
      role: 'member',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerified: false,
      approved: false,
    });

    const token = await loginAs(ADMIN_EMAIL);
    const res = await request(app)
      .patch(`/api/users/${unverified._id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not verified/i);
    const reread = await User.findById(unverified._id).lean();
    expect(reread.approved).toBe(false);
  });

  it('answers 404 when an admin approves an id that matches nobody', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    // Well-formed but unused: the id must reach the lookup, so this tests the
    // "no such account" path rather than an id-format rejection.
    const unknownId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .patch(`/api/users/${unknownId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(404);
  });

  it('refuses an admin revoking their own approval with 400', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    const res = await request(app)
      .patch(`/api/users/${admin._id}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(400);
    const reread = await User.findById(admin._id).lean();
    expect(reread.approved).toBe(true); // still approved — the board stays unlocked
  });
});

describe('approval takes effect on the EXISTING token — no re-login', () => {
  // This is the whole reason `approved` is read from the user document on every
  // request instead of being baked into the JWT as a claim. A claim would stay
  // stale until the member signed in again; the admin would approve them and
  // nothing would happen on screen. Here the member's token is minted BEFORE the
  // approval and is reused unchanged afterwards.
  it('an admin approval unlocks the members tier for a token minted before it', async () => {
    const memberToken = await loginAs(PENDING_EMAIL);

    const before = await listAs(memberToken);
    expect(before.status).toBe(200);
    expect(before.body.map((m) => m.title)).not.toContain('הודעת חברים');

    const adminToken = await loginAs(ADMIN_EMAIL);
    const approve = await request(app)
      .patch(`/api/users/${pendingMember._id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(approve.status).toBe(200);
    expect(approve.body.approved).toBe(true);
    expect(approve.body.approvedBy).toBe(String(admin._id));
    expect(approve.body.approvedAt).toBeTruthy();
    // An approval response must never carry a credential.
    expect(JSON.stringify(approve.body)).not.toContain('passwordHash');
    expect(approve.body.emailVerificationTokenHash).toBeUndefined();

    // Same token as `before` — no second login anywhere in this test.
    const after = await listAs(memberToken);
    expect(after.status).toBe(200);
    const titles = after.body.map((m) => m.title);
    expect(titles).toContain('הודעה ציבורית');
    expect(titles).toContain('הודעת חברים');
    expect(after.headers['x-total-count']).toBe('2');

    const byId = await request(app)
      .get(`/api/messages/${membersMsg._id}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(byId.status).toBe(200);
  });

  it('a revoke returns the member to public-only on that same token', async () => {
    const memberToken = await loginAs(MEMBER_EMAIL);

    const before = await listAs(memberToken);
    expect(before.body.map((m) => m.title)).toContain('הודעת חברים');

    const adminToken = await loginAs(ADMIN_EMAIL);
    const revoke = await request(app)
      .patch(`/api/users/${approvedMember._id}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(revoke.status).toBe(200);
    expect(revoke.body.approved).toBe(false);
    // The audit fields are cleared, not left behind reading like an approval.
    expect(revoke.body.approvedAt).toBeUndefined();
    expect(revoke.body.approvedBy).toBeUndefined();

    const after = await listAs(memberToken);
    expect(after.status).toBe(200);
    expect(after.body.map((m) => m.title)).not.toContain('הודעת חברים');
    expect(after.headers['x-total-count']).toBe('1');
  });
});

describe('what an unapproved member may WRITE', () => {
  // Reading is public by design. Writing is membership: a stranger who registers
  // with an address they control and clicks the verification link must not be
  // able to publish to the community board — or push a file into the bucket —
  // before an admin has admitted them.
  it('refuses an unapproved member POSTing a message with 403, and stores nothing', async () => {
    const token = await loginAs(PENDING_EMAIL);
    const before = await Message.countDocuments();

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: 'cat-1', title: 'מאת אדם שטרם אושר', text: 'לא אמור להישמר' });

    expect(res.status).toBe(403);
    expect(await Message.countDocuments()).toBe(before);
    expect(await Message.findOne({ title: 'מאת אדם שטרם אושר' }).lean()).toBeNull();
  });

  it('refuses an unapproved member POSTing MULTIPART with a file, with 403', async () => {
    // The JSON test above cannot see the failure this one is for. multer only
    // engages on a multipart request, so a refactor that moved upload.single()
    // ahead of requireApproved would leave every JSON assertion green while an
    // unapproved caller buffered 5MB into memory (multer uses memoryStorage) and
    // the controller pushed it to S3 — on every request, before the refusal.
    const token = await loginAs(PENDING_EMAIL);
    const before = await Message.countDocuments();

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .field('categoryId', 'cat-1')
      .field('title', 'קובץ מאת אדם שטרם אושר')
      .field('text', 'לא אמור להישמר')
      .attach('file', Buffer.from('not-a-real-image'), { filename: 'probe.png', contentType: 'image/png' });

    expect(res.status).toBe(403);
    expect(await Message.countDocuments()).toBe(before);
    expect(await Message.findOne({ title: 'קובץ מאת אדם שטרם אושר' }).lean()).toBeNull();
  });

  it('refuses an unapproved member PATCHing MULTIPART with a file, with 403', async () => {
    const token = await loginAs(PENDING_EMAIL);

    const res = await request(app)
      .patch(`/api/messages/${publicMsg._id}`)
      .set('Authorization', `Bearer ${token}`)
      .field('categoryId', 'cat-1')
      .field('title', 'הושחת עם קובץ')
      .attach('file', Buffer.from('not-a-real-image'), { filename: 'probe.png', contentType: 'image/png' });

    expect(res.status).toBe(403);
    expect((await Message.findById(publicMsg._id).lean()).title).toBe('הודעה ציבורית');
  });

  it('refuses an unapproved member PATCHing a message with 403, leaving it unchanged', async () => {
    const token = await loginAs(PENDING_EMAIL);

    const res = await request(app)
      .patch(`/api/messages/${publicMsg._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: 'cat-1', title: 'הושחת' });

    expect(res.status).toBe(403);
    expect((await Message.findById(publicMsg._id).lean()).title).toBe('הודעה ציבורית');
  });

  it('still lets an APPROVED member post and edit their own message', async () => {
    // The gate must not over-tighten into "admins only" — an admitted resident is
    // exactly who the board is for.
    const token = await loginAs(MEMBER_EMAIL);

    const created = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: 'cat-1', title: 'מאת חבר מאושר', text: 'שלום' });
    expect(created.status).toBe(200);

    const edited = await request(app)
      .patch(`/api/messages/${created.body._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: 'cat-1', title: 'נערך בידי חבר מאושר' });
    expect(edited.status).toBe(200);
    expect((await Message.findById(created.body._id).lean()).title).toBe('נערך בידי חבר מאושר');
  });

  it('lets an admin post even when their own approved flag is false', async () => {
    // The same explicit admin bypass the content-tier check uses: an admin seeded
    // before this field existed must never be locked out of their own board.
    await User.findByIdAndUpdate(admin._id, { $set: { approved: false } });
    const token = await loginAs(ADMIN_EMAIL);

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: 'cat-1', title: 'מאת מנהל לא מסומן כמאושר' });

    expect(res.status).toBe(200);
  });
});

describe('changing a role — the only way to take an admin’s powers away', () => {
  // Until this route existed, a compromised admin could not be contained through
  // the API at all: revoking their approval takes nothing away (every check
  // bypasses on role === 'admin'), and nothing else touched `role`. That is why
  // revokeUser refuses on an admin, and why its message now points here.
  const setRole = (token, id, role) =>
    request(app).patch(`/api/users/${id}/role`).set('Authorization', `Bearer ${token}`).send({ role });

  it('lets an admin demote another admin to member', async () => {
    const otherAdmin = await User.create({
      name: 'Second Admin',
      email: 'role-admin-2@test.example.com',
      role: 'admin',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerified: true,
      approved: true,
    });

    const token = await loginAs(ADMIN_EMAIL);
    const res = await setRole(token, otherAdmin._id, 'member');

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('member');
    expect((await User.findById(otherAdmin._id).lean()).role).toBe('member');
    // The response is the same narrowed shape as approve/revoke — no credentials.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('lets an admin promote a member', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    const res = await setRole(token, approvedMember._id, 'admin');

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    expect((await User.findById(approvedMember._id).lean()).role).toBe('admin');
  });

  it('refuses an admin changing their OWN role, even with an UPPER-CASE hex id', async () => {
    // Guard 2. The upper-cased id is the bypass that got past the self-revoke
    // guard once: Mongo parses ObjectId hex case-insensitively, so this reaches
    // the very same document while `String(a) === String(b)` says it does not.
    //
    // A SECOND admin exists here on purpose. With only one admin the last-admin
    // guard answers first (by design — see the controller), and this test would
    // be passing on the wrong refusal.
    await User.create({
      name: 'Second Admin',
      email: 'role-admin-2@test.example.com',
      role: 'admin',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerified: true,
      approved: true,
    });

    const token = await loginAs(ADMIN_EMAIL);

    const direct = await setRole(token, admin._id, 'member');
    expect(direct.status).toBe(400);
    expect(direct.body.error).toMatch(/cannot change their own role/i);

    const upperCasedId = String(admin._id).toUpperCase();
    expect(upperCasedId).not.toBe(String(admin._id)); // the mutation must be real

    const cased = await setRole(token, upperCasedId, 'member');
    expect(cased.status).toBe(400);
    expect(cased.body.error).toMatch(/cannot change their own role/i);

    expect((await User.findById(admin._id).lean()).role).toBe('admin'); // untouched
  });

  it('demotes the second-to-last admin, then refuses the last one', async () => {
    // Guard 1, both sides in one test so the refusal cannot be a blanket "no".
    //
    // Why the last admin is always the CALLER: requireRole means only an admin
    // reaches this route, so whenever the target is a different admin there are
    // at least two. The single-admin case is therefore reachable only as "the
    // last admin demotes themselves", which is exactly what this asserts — and
    // why the controller checks the count BEFORE the self-guard.
    const otherAdmin = await User.create({
      name: 'Second Admin',
      email: 'role-admin-2@test.example.com',
      role: 'admin',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerified: true,
      approved: true,
    });
    expect(await User.countDocuments({ role: 'admin' })).toBe(2);

    // Second-to-last: allowed.
    const adminToken = await loginAs(ADMIN_EMAIL);
    const allowed = await setRole(adminToken, otherAdmin._id, 'member');
    expect(allowed.status).toBe(200);
    expect(allowed.body.role).toBe('member');
    expect(await User.countDocuments({ role: 'admin' })).toBe(1);

    // Last: refused, and refused for the RIGHT reason — the message has to be the
    // last-admin one, not the self-guard's "ask another admin", which would be
    // useless advice with no other admin left to ask.
    const refused = await setRole(adminToken, admin._id, 'member');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/last remaining admin/i);

    // And the board still has its admin.
    expect(await User.countDocuments({ role: 'admin' })).toBe(1);
    expect((await User.findById(admin._id).lean()).role).toBe('admin');
  });

  it('rejects a role that is not in the schema enum with 400', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    const res = await setRole(token, approvedMember._id, 'superadmin');
    expect(res.status).toBe(400);
    expect((await User.findById(approvedMember._id).lean()).role).toBe('member');
  });

  it('answers 403 when a plain member calls it', async () => {
    const token = await loginAs(MEMBER_EMAIL);
    const res = await setRole(token, pendingMember._id, 'admin');

    expect(res.status).toBe(403);
    expect((await User.findById(pendingMember._id).lean()).role).toBe('member');
  });

  it('answers 404 for an id that matches nobody', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    const res = await setRole(token, new mongoose.Types.ObjectId(), 'member');
    expect(res.status).toBe(404);
  });

  it('a demotion takes effect on the demoted admin’s EXISTING token', async () => {
    // The whole reason `role` is read from the user document on every request.
    // A JWT claim would keep the demoted admin fully powered until their token
    // expired — which is exactly no containment at all.
    const victim = await User.create({
      name: 'Doomed Admin',
      email: 'role-doomed@test.example.com',
      role: 'admin',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerified: true,
      approved: true,
    });
    const victimToken = await loginAs('role-doomed@test.example.com');

    // Proof it really is an admin token before the demotion.
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${victimToken}`)).status).toBe(200);

    const adminToken = await loginAs(ADMIN_EMAIL);
    expect((await setRole(adminToken, victim._id, 'member')).status).toBe(200);

    // Same token, unchanged, reused — no second login anywhere below.
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${victimToken}`)).status).toBe(403);
    expect((await request(app).delete('/api/messages').set('Authorization', `Bearer ${victimToken}`)).status).toBe(403);
    expect((await setRole(victimToken, pendingMember._id, 'admin')).status).toBe(403);
    expect(await Message.countDocuments()).toBe(2); // nothing was wiped on the way
  });

  it('points a refused admin-revoke at this route instead of saying it cannot be done', async () => {
    const otherAdmin = await User.create({
      name: 'Second Admin',
      email: 'role-admin-2@test.example.com',
      role: 'admin',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerified: true,
      approved: true,
    });

    const token = await loginAs(ADMIN_EMAIL);
    const res = await request(app)
      .patch(`/api/users/${otherAdmin._id}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(400);
    // The refusal stands — revoking approval still is not the tool for this —
    // but it now names the tool that is.
    expect(res.body.error).toMatch(/\/api\/users\/:userId\/role/);
  });
});

describe('a revocation leaves a trail, and the two states stay coherent', () => {
  // Approving recorded who and when; revoking only $unset those fields, so a
  // withdrawn admission was indistinguishable from an account that had never been
  // admitted. "Who removed them?" had no answer anywhere in the database.
  it('records revokedAt and revokedBy, and clears them again on a re-approval', async () => {
    const adminToken = await loginAs(ADMIN_EMAIL);

    const revoke = await request(app)
      .patch(`/api/users/${approvedMember._id}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();
    expect(revoke.status).toBe(200);
    expect(revoke.body.revokedBy).toBe(String(admin._id));
    expect(revoke.body.revokedAt).toBeTruthy();

    // The stored document, not just the response body.
    const afterRevoke = await User.findById(approvedMember._id).lean();
    expect(afterRevoke.approved).toBe(false);
    expect(afterRevoke.revokedBy).toBe(String(admin._id));
    expect(afterRevoke.revokedAt).toBeInstanceOf(Date);
    // The approval trail is gone, so nothing reads as still-approved.
    expect(afterRevoke.approvedAt).toBeUndefined();
    expect(afterRevoke.approvedBy).toBeUndefined();

    const approve = await request(app)
      .patch(`/api/users/${approvedMember._id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();
    expect(approve.status).toBe(200);
    expect(approve.body.revokedAt).toBeUndefined();
    expect(approve.body.revokedBy).toBeUndefined();

    // Re-approving must clear the revocation, or the document would carry both
    // trails at once and leave the reader guessing which one happened last.
    const afterApprove = await User.findById(approvedMember._id).lean();
    expect(afterApprove.approved).toBe(true);
    expect(afterApprove.approvedBy).toBe(String(admin._id));
    expect(afterApprove.revokedAt).toBeUndefined();
    expect(afterApprove.revokedBy).toBeUndefined();
  });
});

describe('revoke refuses the moves that would only look like they worked', () => {
  it("refuses to revoke an ADMIN's approval and leaves the flag alone", async () => {
    // Every authorization check in the app bypasses on role === 'admin', so
    // flipping this boolean on an admin takes nothing away: they keep reading,
    // deleting and approving — and can approve themselves back — while the
    // dashboard shows them as pending. A 200 here would tell the owner they had
    // contained a compromised account when they had not.
    const otherAdmin = await User.create({
      name: 'Second Admin',
      email: 'approval-admin-2@test.example.com',
      role: 'admin',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerified: true,
      approved: true,
    });

    const token = await loginAs(ADMIN_EMAIL);
    const res = await request(app)
      .patch(`/api/users/${otherAdmin._id}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(400);
    const reread = await User.findById(otherAdmin._id).lean();
    expect(reread.approved).toBe(true); // untouched — no half-done containment
    expect(reread.role).toBe('admin');
  });

  it('holds the self-revoke guard when the id arrives in UPPER-CASE hex', async () => {
    // MongoDB parses an ObjectId from hex case-insensitively, so an upper-cased
    // id reaches the very same document. A string compare said "different user"
    // and waved the admin straight past their own self-revoke guard.
    const token = await loginAs(ADMIN_EMAIL);
    const upperCasedId = String(admin._id).toUpperCase();
    expect(upperCasedId).not.toBe(String(admin._id)); // the mutation must be real

    const res = await request(app)
      .patch(`/api/users/${upperCasedId}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(400);
    // The MESSAGE matters, not just the status. The admin-revoke refusal above
    // also answers 400, so a status-only assertion would still pass while the
    // self-revoke guard sat wide open — the uppercased id would sail past it and
    // be stopped only by the later check. Pinning the message keeps this test
    // about the guard it is named after.
    expect(res.body.error).toMatch(/cannot revoke their own approval/i);
    expect((await User.findById(admin._id).lean()).approved).toBe(true);
  });

  it('answers 400, not 500, when the id is not an ObjectId at all', async () => {
    const token = await loginAs(ADMIN_EMAIL);
    const res = await request(app).patch('/api/users/not-an-object-id/revoke').set('Authorization', `Bearer ${token}`);

    expect([400, 404]).toContain(res.status);
  });
});

describe('the CSRF Bearer exemption follows how auth resolves identity', () => {
  it('still demands a CSRF token when a bogus Bearer header rides alongside the auth cookie', async () => {
    // `auth` PREFERS the auth cookie over the Bearer header, so a request
    // carrying both authenticates by COOKIE — the path CSRF exists to defend.
    // Exempting it on the mere presence of a Bearer string handed every allowlisted
    // origin a one-header CSRF bypass.
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken;
    expect(csrf).toBeTruthy();

    const bypass = await agent
      .post('/api/messages')
      .set('Authorization', 'Bearer x')
      .send({ categoryId: 'cat-1', title: 'csrf bypass attempt' });

    expect(bypass.status).toBe(403);
    expect(await Message.findOne({ title: 'csrf bypass attempt' }).lean()).toBeNull();

    // The same cookie session with a real CSRF token is still accepted, so the
    // fix is a narrowing of the exemption and not a blanket block.
    const allowed = await agent
      .post('/api/messages')
      .set('Authorization', 'Bearer x')
      .set('X-CSRF-Token', csrf)
      .send({ categoryId: 'cat-1', title: 'csrf honoured' });
    expect(allowed.status).toBe(200);
  });
});

describe('a demotion takes effect immediately, not when the token expires', () => {
  it('strips admin power from a token minted before the demotion', async () => {
    // `req.role` must come from the user DOCUMENT, not from the JWT claim. When it
    // came from the token, an admin demoted to member in the database kept every
    // admin power for the remaining 12 hours of that token — and an old token
    // deleted the entire messages collection after the demotion. This is the
    // regression test for exactly that.
    const oldAdminToken = await loginAs(ADMIN_EMAIL);

    // Proof the token really is an admin token before the demotion.
    const beforeDirectory = await request(app).get('/api/users').set('Authorization', `Bearer ${oldAdminToken}`);
    expect(beforeDirectory.status).toBe(200);

    await User.findByIdAndUpdate(admin._id, { $set: { role: 'member' } });

    // Same token, unchanged, reused — no second login anywhere in this test.
    const directory = await request(app).get('/api/users').set('Authorization', `Bearer ${oldAdminToken}`);
    expect(directory.status).toBe(403);

    const wipe = await request(app).delete('/api/messages').set('Authorization', `Bearer ${oldAdminToken}`);
    expect(wipe.status).toBe(403);
    expect(await Message.countDocuments()).toBe(2); // the collection survives

    const approve = await request(app)
      .patch(`/api/users/${pendingMember._id}/approve`)
      .set('Authorization', `Bearer ${oldAdminToken}`)
      .send();
    expect(approve.status).toBe(403);
    expect((await User.findById(pendingMember._id).lean()).approved).toBe(false);
  });
});
