import AppError from '../errors/AppError.js';
import errorManagement from '../errors/utils/errorManagement.js';
import { CSRF_COOKIE, CSRF_HEADER } from '../config/cookies.js';

// Reads (GET/HEAD/OPTIONS) don't change state, so they are exempt. Login is also
// exempt: the user has no CSRF cookie yet, and it is protected by the credential
// check itself.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Auth-bootstrap endpoints carry no session cookie, so the double-submit check
// has nothing to compare and would only reject them. register/verify-email/
// resend-verification are the sign-up + activation flow; login/logout are the
// session boundary. Each is protected by its own credential/token check.
const EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
]);

/**
 * Double-submit CSRF check.
 *
 * On login we set two cookies: an httpOnly auth cookie (JS can't read it) and a
 * readable CSRF cookie. The SPA reads the CSRF cookie and echoes its value in the
 * X-CSRF-Token header on every mutating request. A cross-site attacker can cause
 * the browser to send the cookies, but cannot READ the CSRF cookie's value (it's
 * on our origin) to put it in the header — so the two won't match and the request
 * is rejected. Constant-time-ish compare; values are random hex of equal length.
 */
const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) {
    return next();
  }

  // CSRF only threatens cookie-based auth, because the browser attaches cookies
  // automatically on a forged cross-site request. A client that authenticates
  // with an explicit `Authorization: Bearer` header is not exposed — the browser
  // never auto-sends that header cross-site — so header-auth requests skip the
  // check. This is also what keeps API clients and the Bearer-based test suite
  // working unchanged.
  const authHeader = req.headers?.authorization;
  const usesBearer = authHeader && authHeader.startsWith('Bearer ');
  if (usesBearer) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(
      new AppError(
        errorManagement.commonErrors.authorizationError.message,
        errorManagement.commonErrors.authorizationError.code,
        true,
      ),
    );
  }

  return next();
};

export default csrfProtection;
