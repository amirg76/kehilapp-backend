/**
 * Cookie + CSRF auth flow (integration).
 *
 * Locks in the httpOnly-cookie session model and its double-submit CSRF defence,
 * verified live against a running server first and now pinned here so a
 * regression fails CI.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';

beforeEach(async () => {
  await User.deleteMany({});
  const passwordHash = await bcrypt.hash('cookie-fixture-pw-A7f2', 4);
  await User.create({
    name: 'Cookie Admin',
    email: 'cookie-admin@test.example.com',
    passwordHash,
    role: 'admin',
    // Login refuses unverified accounts; this fixture tests the cookie/CSRF flow.
    emailVerified: true,
    // An admitted member of the community — approval is gated separately.
    approved: true,
  });
});

/** Log in with a supertest agent so it keeps the Set-Cookie jar, and return the CSRF token. */
const loginAgent = async () => {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .send({ email: 'cookie-admin@test.example.com', password: 'cookie-fixture-pw-A7f2' });
  return { agent, csrf: res.body.csrfToken, res };
};

describe('cookie + CSRF auth', () => {
  it('login sets an httpOnly auth cookie and a readable CSRF cookie', async () => {
    const { res } = await loginAgent();
    const cookies = res.headers['set-cookie'].join('\n');

    expect(cookies).toMatch(/token=.*HttpOnly/i); // auth cookie is httpOnly
    expect(cookies).toMatch(/csrfToken=/); // csrf cookie is present
    expect(cookies).not.toMatch(/csrfToken=[^;]*;[^\n]*HttpOnly/i); // ...and NOT httpOnly
    expect(res.body.csrfToken).toBeTruthy();
  });

  it('authenticates a GET using only the cookie (no Authorization header)', async () => {
    const { agent } = await loginAgent();
    const res = await agent.get('/api/messages');
    expect(res.status).toBe(200);
  });

  it('blocks a cookie-authenticated mutation with no CSRF header', async () => {
    const { agent } = await loginAgent();
    const res = await agent.post('/api/messages').send({ categoryId: 'c', title: 'no csrf' });
    expect(res.status).toBe(403);
  });

  it('allows a cookie-authenticated mutation with the matching CSRF header', async () => {
    const { agent, csrf } = await loginAgent();
    const res = await agent
      .post('/api/messages')
      .set('X-CSRF-Token', csrf)
      .send({ categoryId: 'cat-1', title: 'with csrf' });
    expect(res.status).toBe(200);
  });

  it('blocks a cookie-authenticated mutation with a wrong CSRF header', async () => {
    const { agent } = await loginAgent();
    const res = await agent
      .post('/api/messages')
      .set('X-CSRF-Token', 'not-the-real-token')
      .send({ categoryId: 'c', title: 'bad csrf' });
    expect(res.status).toBe(403);
  });

  it('does not require CSRF for Bearer-header clients (not cross-site exposed)', async () => {
    const { res } = await loginAgent();
    const token = res.body.token;
    // Bearer header, no cookies, no CSRF header — should be allowed.
    const r = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: 'cat-1', title: 'bearer no csrf' });
    expect(r.status).toBe(200);
  });

  it('GET /api/auth/me returns the identity behind the cookie', async () => {
    // The reason this endpoint exists: after a reload the SPA holds a session it
    // cannot read (httpOnly, by design). This is the only way back to "who am I".
    const { agent } = await loginAgent();
    const res = await agent.get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: 'cookie-admin@test.example.com',
      role: 'admin',
    });
    // Never hand back a credential in an identity response.
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('token');
  });

  it('GET /api/auth/me refuses an anonymous caller', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me stops working after logout', async () => {
    const { agent, csrf } = await loginAgent();
    await agent.post('/api/auth/logout').set('x-csrf-token', csrf);

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('logout clears the auth cookie', async () => {
    const { agent } = await loginAgent();
    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(200);
    const cleared = res.headers['set-cookie'].join('\n');
    expect(cleared).toMatch(/token=;/); // cookie set to empty
  });
});
