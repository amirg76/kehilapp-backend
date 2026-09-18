/**
 * Route guards — the gate.
 *
 * Three rules, all default-deny:
 *
 *   1. Every registered route runs the auth middleware, unless it is listed in
 *      PUBLIC_ROUTES below.
 *   2. Every destructive route (DELETE) additionally names the roles allowed to
 *      call it.
 *   3. Every write route (POST/PUT/PATCH) additionally checks MEMBERSHIP —
 *      requireApproved, or a requireRole guard that does not admit plain
 *      'member' — unless it is listed in MEMBERSHIP_EXEMPT_WRITES below.
 *   4. A write route that is public must ALSO be listed in
 *      MEMBERSHIP_EXEMPT_WRITES, so one list cannot exempt a write from
 *      membership behind a reviewer's back.
 *   5. Where a route has both requireApproved and multer, requireApproved runs
 *      FIRST — being on the stack is not the same as being in front of it.
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
import upload from '../middlewares/multer.js';

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

/**
 * Routes that are not destructive but are still an admin act, so rule 2 has to
 * cover them explicitly. Admitting a resident to the community — and withdrawing
 * that admission — decides who sees members-only content. Without this list a
 * dropped requireRole would leave every signed-in member able to approve
 * themselves, and rule 2 (DELETE only) would never notice.
 */
const ADMIN_ONLY_ROUTES = [
  'PATCH /api/users/:userId/approve',
  'PATCH /api/users/:userId/revoke',
  // Changing a role is the strongest act in the API: it is the only way to take
  // an admin's powers away, and equally the only way to hand them out.
  'PATCH /api/users/:userId/role',
  // The only route in this API that spends money. It shipped its first cut with
  // `requireApproved` alone, and a live run proved a seeded member got 200 from
  // it; listing it here is what makes that a test failure rather than something
  // a reviewer has to notice again.
  'POST /api/messages/classify',
];

/**
 * Write routes that are authenticated but deliberately do NOT require membership.
 *
 * Rule 3 says a write is membership: verifying an email proves the address, not
 * that the holder belongs to the kibbutz, so an unapproved account may read
 * public content and nothing more. Ending your own session is the one write that
 * cannot be membership-gated — a pending account has a session and must be able
 * to close it. Keep this list short and justify every addition in review.
 *
 * Rule 4 makes this the single list: a write route in PUBLIC_ROUTES has to appear
 * here too. Before that, PUBLIC_ROUTES quietly exempted a write from BOTH the auth
 * rule and the membership rule, while this comment sent a reviewer looking only at
 * the list below — one edit in the wrong file and a write route lost its
 * membership check with nothing to show for it.
 */
const MEMBERSHIP_EXEMPT_WRITES = [
  'POST /api/auth/logout',
  // The four public writes, repeated here on purpose (rule 4). Each is a write by
  // someone who has no membership yet and by definition cannot have one: signing
  // in, creating the account, activating it from the emailed link, or asking for
  // that link again.
  'POST /api/auth/login',
  'POST /api/auth/register',
  'POST /api/auth/verify-email',
  'POST /api/auth/resend-verification',
];

const WRITE_METHODS = ['POST', 'PUT', 'PATCH'];

/**
 * The function name Express records for a multer middleware layer.
 *
 * Derived at run time from multer itself rather than hardcoded: `upload.single()`
 * builds a fresh closure per call, so identity against the route's layer is
 * impossible, but every one of those closures is the same named function from
 * multer's make-middleware. Reading the name off a probe means a multer upgrade
 * that renames it moves this constant with it instead of silently turning the
 * order test into a no-op.
 */
const MULTER_LAYER_NAME = upload.single('__probe__').name;

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

/**
 * True when this route's role guard is strict enough to STAND IN for the
 * membership check.
 *
 * requireRole never reads `approved` — it only compares `req.role`. So
 * requireRole('member', 'admin') on a write route satisfied "has a role guard"
 * while admitting every signed-in account, approved or not, which is precisely
 * the hole requireApproved exists to close. A role guard substitutes for
 * membership only when 'member' is not among the roles it admits, i.e. when it
 * has already narrowed the route to something stricter than "any resident".
 */
const hasMembershipRoleGuard = (route) =>
  route.stack.some((handlerLayer) => {
    const roles = handlerLayer.handle && handlerLayer.handle.allowedRoles;
    return Array.isArray(roles) && roles.length > 0 && !roles.includes('member');
  });

/**
 * Position of the layer that decides membership for this route, or -1.
 * Either guard qualifies — requireApproved, or a role guard strict enough to
 * stand in for it (see hasMembershipRoleGuard). The category upload routes use
 * the second form: requireRole('admin') already excludes every unapproved caller.
 */
const membershipGuardIndex = (route) =>
  route.stack.findIndex((handlerLayer) => {
    const handler = handlerLayer.handle;
    if (!handler) return false;
    if (handler.requiresApproval === true) return true;
    const roles = handler.allowedRoles;
    return Array.isArray(roles) && roles.length > 0 && !roles.includes('member');
  });

/** Position of the multer layer in this route's stack, or -1. */
const multerIndex = (route) =>
  route.stack.findIndex((handlerLayer) => {
    const handler = handlerLayer.handle;
    return (
      (handlerLayer.name === MULTER_LAYER_NAME || (handler && handler.name === MULTER_LAYER_NAME)) &&
      typeof handler === 'function'
    );
  });

/**
 * True when this route's handler stack runs the requireApproved guard.
 * Same tagging trick as requireRole — the middleware sets `requiresApproval` on
 * itself so this check never has to match on a function name or on source text.
 */
const hasApprovalGuard = (route) =>
  route.stack.some((handlerLayer) => handlerLayer.handle && handlerLayer.handle.requiresApproval === true);

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
            membershipRoleGuarded: hasMembershipRoleGuard(layer.route),
            approvalGuarded: hasApprovalGuard(layer.route),
            membershipAt: membershipGuardIndex(layer.route),
            multerAt: multerIndex(layer.route),
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

  it('every write route also checks that the caller is an admitted member', () => {
    // Reading is open to the public by design; writing is membership. A write
    // route carrying `auth` alone lets a stranger who registered with an address
    // they control publish to the community board and push files into the bucket
    // before any admin has admitted them. requireRole(...) satisfies this too —
    // but only when it does NOT admit plain 'member': requireRole reads `role`
    // and never `approved`, so requireRole('member','admin') would let exactly
    // the caller this rule is about straight through.
    //
    // PUBLIC_ROUTES is deliberately NOT consulted here (rule 4 keeps the two
    // lists in step), so this rule cannot be escaped by editing the other file.
    const unguarded = routes
      .filter((r) => WRITE_METHODS.includes(r.method))
      .filter((r) => !MEMBERSHIP_EXEMPT_WRITES.includes(r.id))
      .filter((r) => !r.approvalGuarded && !r.membershipRoleGuarded)
      .map((r) => r.id);

    const detail = unguarded.map((id) => `  - ${id}`).join('\n');
    expect(
      unguarded.length === 0
        ? ''
        : [
            `${unguarded.length} write route(s) accept a signed-in but unapproved caller:`,
            detail,
            '',
            'Add requireApproved after auth (or requireRole(...) if it is an admin act),',
            'or — if the write genuinely must stay open to a pending account — add it to',
            'MEMBERSHIP_EXEMPT_WRITES in this file with a reason.',
          ].join('\n'),
    ).toBe('');
  });

  it('a public WRITE route is also listed in MEMBERSHIP_EXEMPT_WRITES', () => {
    // Rule 4 — closing the second escape hatch. A write route added to
    // PUBLIC_ROUTES used to be excused from the auth rule AND the membership rule
    // at once, while the comment above MEMBERSHIP_EXEMPT_WRITES told a reviewer
    // that the membership exemptions all lived in one place. They did not.
    const known = routes.map((r) => r.id);
    const unlisted = PUBLIC_ROUTES.filter((id) => WRITE_METHODS.includes(id.split(' ')[0]))
      .filter((id) => known.includes(id)) // staleness is the job of the test below
      .filter((id) => !MEMBERSHIP_EXEMPT_WRITES.includes(id));

    const detail = unlisted.map((id) => `  - ${id}`).join('\n');
    expect(
      unlisted.length === 0
        ? ''
        : [
            `${unlisted.length} public write route(s) are exempt from membership via PUBLIC_ROUTES alone:`,
            detail,
            '',
            'A write route may not be exempted by one list only. Add each to',
            'MEMBERSHIP_EXEMPT_WRITES as well, with the reason it must stay open to a',
            'caller who has no membership.',
          ].join('\n'),
    ).toBe('');
  });

  it('a role guard that still admits plain members does not count as a membership check', () => {
    // Rule 3, pinned directly rather than only through the route table: this is
    // the discriminator that stops requireRole('member','admin') from standing in
    // for requireApproved on a write route.
    const stack = (...handlers) => ({ stack: handlers.map((handle) => ({ handle, name: handle.name })) });
    const roleGuard = (...roles) => Object.assign(() => {}, { allowedRoles: roles });

    expect(hasMembershipRoleGuard(stack(roleGuard('admin')))).toBe(true);
    expect(hasMembershipRoleGuard(stack(roleGuard('member', 'admin')))).toBe(false);
    expect(hasMembershipRoleGuard(stack(roleGuard('member')))).toBe(false);
    // ...while the loose check cannot tell any of them apart, which is why it may
    // no longer be the one rule 3 consults.
    expect(hasRoleGuard(stack(roleGuard('member', 'admin')))).toBe(true);
  });

  it('the membership guard runs BEFORE multer on every upload route', () => {
    // Rule 5. The ordering is the whole point of the guard on an upload route:
    // multer uses memoryStorage, so a layer that runs before the membership check
    // buffers up to 5MB of an unapproved caller's request into RAM — and the
    // controller then pushes it to S3 — for a request that is about to be refused.
    // Asserting only that the guard is PRESENT would keep passing after a refactor
    // moved multer in front of it.
    const uploadRoutes = routes.filter((r) => r.multerAt !== -1);
    expect(uploadRoutes.length).toBeGreaterThan(0); // a vacuous pass is not a pass

    const inverted = uploadRoutes
      .filter((r) => r.membershipAt === -1 || r.membershipAt > r.multerAt)
      .map((r) => `  - ${r.id} (membership guard at ${r.membershipAt}, multer at ${r.multerAt})`);

    expect(
      inverted.length === 0
        ? ''
        : [
            `${inverted.length} upload route(s) reach multer before the membership check:`,
            ...inverted,
            '',
            'Put requireApproved — or requireRole(...) where the route is an admin act —',
            'ahead of upload.single(...) so a refused request never buffers a file.',
          ].join('\n'),
    ).toBe('');
  });

  it('identifies multer layers by a name read from multer itself, not a guess', () => {
    // If a multer upgrade renamed the middleware, MULTER_LAYER_NAME would follow
    // it — but an empty or generic name would make the order test above silently
    // match nothing, or everything.
    expect(MULTER_LAYER_NAME).toBeTruthy();
    expect(['', 'anonymous', 'handle', 'bound ']).not.toContain(MULTER_LAYER_NAME);
  });

  it('every entry in MEMBERSHIP_EXEMPT_WRITES still exists', () => {
    // A typo here would silently exempt nothing — or, worse, outlive its route.
    const known = routes.map((r) => r.id);
    const stale = MEMBERSHIP_EXEMPT_WRITES.filter((id) => !known.includes(id));
    expect(stale).toEqual([]);
  });

  it('every admin-only route also checks the role of the caller', () => {
    const known = routes.map((r) => r.id);

    // A typo in the list would otherwise make this test vacuously pass.
    const missing = ADMIN_ONLY_ROUTES.filter((id) => !known.includes(id));
    expect(missing).toEqual([]);

    const unauthorized = ADMIN_ONLY_ROUTES.filter((id) => !routes.find((r) => r.id === id && r.roleGuarded));

    const detail = unauthorized.map((id) => `  - ${id}`).join('\n');
    expect(
      unauthorized.length === 0
        ? ''
        : [
            `${unauthorized.length} admin-only route(s) accept any authenticated user:`,
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
