/**
 * Security middleware gate.
 *
 * The auth middleware in this repo was written, wired up, then commented out —
 * and nothing noticed. Helmet, the rate limiters and the Mongo sanitiser can be
 * removed exactly as quietly, so they get a test that makes real requests and
 * reads the real responses.
 *
 * These assertions run against a 404 route on purpose: no database, no token,
 * just the middleware chain every request passes through.
 */
import request from 'supertest';
import app from '../app.js';

describe('security middleware', () => {
  it('sets helmet response headers', async () => {
    const res = await request(app).get('/definitely-not-a-route');

    // A representative few rather than all of helmet's headers — enough to fail
    // loudly if helmet is removed, without breaking on a helmet version bump.
    expect(res.headers).toHaveProperty('x-content-type-options', 'nosniff');
    expect(res.headers).toHaveProperty('x-frame-options');
    expect(res.headers).toHaveProperty('content-security-policy');
  });

  it('does not leak the server technology', async () => {
    const res = await request(app).get('/definitely-not-a-route');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('advertises a rate limit on API requests', async () => {
    // Uses a still-protected route so the request short-circuits at the auth
    // guard (401) without needing a database — GET /api/messages is public now
    // and would fall through to a Mongo query this unit test has no DB for.
    const res = await request(app).get('/api/users');

    // draft-7 headers. Their presence proves the limiter ran; 401 from the auth
    // guard is the expected status here and is not what this test is asserting.
    expect(res.headers).toHaveProperty('ratelimit');
  });

  it('allows the CSRF header through CORS preflight', async () => {
    // The double-submit defence is worthless if the browser refuses to send the
    // header. A cross-origin mutating request is preflighted, and the browser
    // blocks the real request when a requested header is absent from
    // Access-Control-Allow-Headers. This shipped missing: curl does not
    // preflight, so every manual test passed while a real browser could not
    // write at all.
    const res = await request(app)
      .options('/api/messages/000000000000000000000000')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'x-csrf-token,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('x-csrf-token');
  });

  it('rejects a login body carrying a Mongo operator', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });

    // Never 200: the sanitiser strips the operators and Joi rejects the shape.
    expect(res.status).not.toBe(200);
    expect([400, 401, 429]).toContain(res.status);
  });
});
