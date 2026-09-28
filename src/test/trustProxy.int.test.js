/**
 * The client address behind two proxies, and what the login limiter does with it.
 *
 * WHAT THIS IS GUARDING. Production runs Client → Caddy → nginx → this server.
 * `trust proxy` was a hard-coded 1, so `req.ip` resolved to Caddy's address for
 * every client on the internet, and the login limiter (10 failures / 15 min)
 * became ONE bucket shared by everyone: ten wrong passwords from anyone locked
 * the whole community out. Found by the pre-deployment security review, which
 * reproduced the resolution with the `proxy-addr` module Express uses.
 *
 * The count is now TRUST_PROXY_HOPS. Both cases send requests that look exactly
 * like the production chain and assert on BEHAVIOUR (who gets a 429), not on the
 * setting. The second case is the bug itself, kept on purpose: it proves the
 * test can tell the two values apart.
 *
 * The setting is flipped on the shared app at runtime rather than by importing
 * a second app: Express recompiles `trust proxy` on every `set`, and a second
 * import would drag in a second mongoose that is not connected to anything.
 */
import request from 'supertest';

import app from '../app.js';
import { trustProxyHops } from '../config/environment.js';

// supertest connects from 127.0.0.1 — that is hop 1 (nginx's place). The header
// carries what Caddy and nginx would have written: the client, then Caddy.
const CADDY = '10.0.0.9';
const asClient = (ip) => `${ip}, ${CADDY}`;

const failLogin = (clientIp) =>
  request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', asClient(clientIp))
    .send({ email: 'nobody@test.example.com', password: 'wrong-password-1' });

/** Ten failures from one client, which is the login limiter's whole budget. */
const exhaustBudget = async (clientIp) => {
  for (let i = 0; i < 10; i += 1) {
    const res = await failLogin(clientIp);
    expect(res.status).toBe(401);
  }
};

afterAll(() => {
  app.set('trust proxy', trustProxyHops());
});

describe('the trust proxy setting', () => {
  it('is read from TRUST_PROXY_HOPS at startup (1 when unset)', () => {
    expect(app.get('trust proxy')).toBe(trustProxyHops());
  });
});

describe('login limiter behind Caddy → nginx (two hops)', () => {
  it('with 2 trusted hops, one client exhausting the budget does not lock out another', async () => {
    app.set('trust proxy', 2);

    await exhaustBudget('198.51.100.10');
    expect((await failLogin('198.51.100.10')).status).toBe(429);

    // A different client, same proxies. With the client address resolved
    // correctly this is a fresh bucket.
    expect((await failLogin('198.51.100.20')).status).toBe(401);
  });

  it('with 2 trusted hops a client cannot escape its bucket by padding the header', async () => {
    app.set('trust proxy', 2);

    // The attacker sends X-Forwarded-For with invented addresses on the LEFT;
    // Caddy and nginx append the real ones on the right. Trusting exactly two
    // hops means the resolver stops at the real client and never reads the
    // padding — so the padded requests land in the same bucket as the plain
    // ones. The header shape below is what the backend would actually receive.
    const forged = (fake) => `${fake}, 192.0.2.77, ${CADDY}`;
    const failForged = (fake) =>
      request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', forged(fake))
        .send({ email: 'nobody@test.example.com', password: 'wrong-password-1' });

    for (let i = 0; i < 10; i += 1) {
      expect((await failForged(`10.9.9.${i}`)).status).toBe(401);
    }
    // Eleventh failure from the same real client, however the padding varies.
    expect((await failForged('10.9.9.200')).status).toBe(429);
    expect((await failLogin('192.0.2.77')).status).toBe(429);
  });

  it('with 1 trusted hop every client shares one bucket — the production bug, kept as proof', async () => {
    app.set('trust proxy', 1);

    // Fresh client addresses so the previous case's buckets play no part; with
    // one hop they all resolve to CADDY anyway, which is the point.
    await exhaustBudget('203.0.113.10');
    expect((await failLogin('203.0.113.10')).status).toBe(429);

    // Trusting one hop stops at Caddy's address, which is the same for everyone.
    expect((await failLogin('203.0.113.20')).status).toBe(429);
  });
});
