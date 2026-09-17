/**
 * Cookie options for the auth + CSRF cookies, in one place.
 *
 * Auth model: the JWT rides in an httpOnly cookie the browser stores and sends
 * automatically. JavaScript cannot read it, so an XSS can no longer lift the
 * token out of localStorage.
 *
 * Because a cookie is sent automatically, it needs CSRF defence. Two layers:
 *  1. SameSite — 'lax' (or 'strict') means the browser withholds the cookie on
 *     cross-site requests, which covers app.example.com <-> api.example.com
 *     (same site) and blocks a foreign site from riding the session.
 *  2. A double-submit CSRF token (see middlewares/csrf.js) for defence in depth
 *     and for the truly cross-site deployment where SameSite must be 'none'.
 *
 * Secure + SameSite come from the environment so local http dev works while
 * production stays locked down:
 *   COOKIE_SAMESITE = strict | lax | none   (default: lax)
 *   COOKIE_SECURE   = true | false          (default: true in production)
 * SameSite=none is only valid together with Secure, so it forces Secure on.
 *
 * "In production" is config/environment.js's answer, not a string comparison
 * here. This line used to read `NODE_ENV === 'production'`, which is false under
 * `npm run prod` — so the one command that deploys this shipped the session
 * cookie WITHOUT Secure, over a deployment that is meant to be HTTPS.
 */
import { isProduction } from './environment.js';

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

const sameSite = () => (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();

const secure = () => {
  if (sameSite() === 'none') return true; // browsers reject SameSite=None without Secure
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
  return isProduction();
};

export const AUTH_COOKIE = 'token';
export const CSRF_COOKIE = 'csrfToken';
export const CSRF_HEADER = 'x-csrf-token';
export const COOKIE_MAX_AGE = TWELVE_HOURS;

/** The httpOnly session cookie — never readable from JS. */
export const authCookieOptions = () => ({
  httpOnly: true,
  secure: secure(),
  sameSite: sameSite(),
  maxAge: COOKIE_MAX_AGE,
  path: '/',
});

/** The CSRF cookie — deliberately readable by JS so the SPA can echo it back. */
export const csrfCookieOptions = () => ({
  httpOnly: false,
  secure: secure(),
  sameSite: sameSite(),
  maxAge: COOKIE_MAX_AGE,
  path: '/',
});
