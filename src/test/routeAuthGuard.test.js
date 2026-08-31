/**
 * Route guards — the gate.
 *
 * Two rules, both default-deny:
 *
 *   1. Every registered route runs the auth middleware, unless it is listed in
 *      PUBLIC_ROUTES below.
 *   2. Every destructive route (DELETE) additionally names the roles allowed to
 *      call it.
 *
 * This file exists because the auth middleware was written, hit a bug, was
 * commented out to keep the MVP moving, and shipped that way. The middleware was
 * never the missing piece — the gate was. Rule 2 was added after restoring
 * authentication revealed the next layer of the same problem: every signed-in
 * member could still empty the message collection.
 *
 * Env placeholders live in jest.setup.env.cjs (`setupFiles`), not here:
 * services/s3.js reads env vars at import time, and ESM imports are hoisted
 * above any assignment written in this file.
 */
import app from '../app.js';
import auth from '../middlewares/auth.js';

/**
 * Routes that are intentionally reachable without a token.
 * Anything not listed here MUST carry the auth middleware.
 * Keep this list short and justify every addition in review.
 */
const PUBLIC_ROUTES = [
  'POST /api/auth/login',
  // Self-registration + email verification. These MUST be reachable without a
  // token: the caller has no account yet (register), or is activating one from
  // an emailed link before they can ever log in (verify-email), or is asking for
  // that link to be re-sent (resend-verification). Each carries its own
  // credential/token check and its own celebrate validation, and login itself
  // refuses any account whose email is not yet verified.
  'POST /api/auth/register',
  'POST /api/auth/verify-email',
  'POST /api/auth/resend-verification',
  // Health probes: a check that needs a token fails exactly when needed most.
  'GET /healthz',
  'GET /readyz',
  // Public read of the community board (demo/showcase posture). Writes and the
  // user directory stay authenticated.
  'GET /api/messages/',
  'GET /api/messages/:id',
  'GET /api/categories/',
  'GET /api/categories/:id',
];

/** Recover the mount path of a router layer from the regexp Express builds for it. */
const mountPathOf = (layer) => {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const source = layer.regexp ? layer.regexp.source : '';
  return source
    .replace(/^\^\\\//, '/')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/')
    .replace(/\$$/, '')
    .replace(/\?$/, '');
};

/** True when this route's handler stack runs the auth middleware. */
const hasAuthGuard = (route) =>
  route.stack.some((handlerLayer) => {
    const handler = handlerLayer.handle;
    // Identity first — survives renaming. Name check covers babel/ESM interop.
    return handler === auth || handlerLayer.name === 'auth' || (handler && handler.name === 'auth');
  });

/**
 * True when this route's handler stack runs a requireRole guard.
 * requireRole tags the closure it returns with `allowedRoles` precisely so this
 * check does not have to match on source text.
 */
const hasRoleGuard = (route) =>
  route.stack.some((handlerLayer) => Array.isArray(handlerLayer.handle && handlerLayer.handle.allowedRoles));

/** Flatten the Express router tree into one row per method+path. */
const collectRoutes = (expressApp) => {
  const rows = [];

  const walk = (stack, prefix) => {
    stack.forEach((layer) => {
      if (layer.route) {
        // app.all('*') is the 404 fallback in app.js. Express expands it into one
        // entry per HTTP verb, and it serves no data — it only builds a not-found
        // error. Skipping it keeps the failure list readable. The match is
        // deliberately narrow (app level, literal '*') so no real route hides here.
        if (prefix === '' && layer.route.path === '*') return;

        const methods = Object.keys(layer.route.methods)
          .filter((m) => layer.route.methods[m])
          .map((m) => m.toUpperCase());
        const path = `${prefix}${layer.route.path}`.replace(/\/{2,}/g, '/');

        methods.forEach((method) => {
          rows.push({
            id: `${method} ${path}`,
            method,
            guarded: hasAuthGuard(layer.route),
            roleGuarded: hasRoleGuard(layer.route),
          });
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, `${prefix}${mountPathOf(layer)}`);
      }
    });
  };

  walk(expressApp._router.stack, '');
  return rows;
};

describe('route guards', () => {
  const routes = collectRoutes(app);

  it('discovers the registered routes', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('every non-public route runs the auth middleware', () => {
    const unguarded = routes
      .filter((r) => !PUBLIC_ROUTES.includes(r.id))
      .filter((r) => !r.guarded)
      .map((r) => r.id);

    const detail = unguarded.map((id) => `  - ${id}`).join('\n');
    expect(
      unguarded.length === 0
        ? ''
        : [
            `${unguarded.length} route(s) are reachable without authentication:`,
            detail,
            '',
            'Add the auth middleware to the route, or — if it is genuinely public —',
            'add it to PUBLIC_ROUTES in this file with a reason.',
          ].join('\n'),
    ).toBe('');
  });

  it('every destructive route also checks the role of the caller', () => {
    // Authentication is not authorization. Restoring the auth middleware still
    // left every signed-in member able to empty the message collection.
    const unauthorized = routes
      .filter((r) => r.method === 'DELETE')
      .filter((r) => !r.roleGuarded)
      .map((r) => r.id);

    const detail = unauthorized.map((id) => `  - ${id}`).join('\n');
    expect(
      unauthorized.length === 0
        ? ''
        : [
            `${unauthorized.length} destructive route(s) accept any authenticated user:`,
            detail,
            '',
            'Add requireRole(...) after auth on each, naming the roles allowed to run it.',
          ].join('\n'),
    ).toBe('');
  });

  it('every entry in PUBLIC_ROUTES still exists', () => {
    // Stops the allowlist from silently outliving the routes it exempts.
    const known = routes.map((r) => r.id);
    const stale = PUBLIC_ROUTES.filter((id) => !known.includes(id));
    expect(stale).toEqual([]);
  });
});
