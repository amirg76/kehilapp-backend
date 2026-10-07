/**
 * CSRF double-submit: the token comparison itself.
 *
 * middlewares/csrf.js promised a constant-time compare in its comment while the
 * code did a plain `!==`. The code now uses crypto.timingSafeEqual, and these
 * tests pin the three cases that matter for it: identical tokens pass, tokens
 * of the same length that differ are refused, and tokens of DIFFERENT lengths
 * are refused without throwing (timingSafeEqual itself throws on unequal
 * lengths, so a careless call there would turn a bad header into a 500).
 *
 * No database and no HTTP: the middleware is called directly with a fake
 * request. The request must look like a COOKIE-authenticated mutating call,
 * because reads, the auth bootstrap paths and Bearer-only calls are exempt.
 */
import csrfProtection, { tokensMatch } from '../middlewares/csrf.js';
import { AUTH_COOKIE, CSRF_COOKIE, CSRF_HEADER } from '../config/cookies.js';
import AppError from '../errors/AppError.js';
import errorManagement from '../errors/utils/errorManagement.js';

// Low entropy on purpose: a random-looking hex literal here made gitleaks in
// CI report a leaked API key (7.10.2026). The compare only needs two equal-
// length strings; it does not care what they look like.
const TOKEN = 'ab'.repeat(16);

const fakeRequest = ({ cookieToken, headerToken }) => ({
  method: 'POST',
  path: '/api/messages',
  headers: {},
  cookies: { [AUTH_COOKIE]: 'session-jwt', [CSRF_COOKIE]: cookieToken },
  get: (name) => (name.toLowerCase() === CSRF_HEADER ? headerToken : undefined),
});

const run = (tokens) => {
  const next = jest.fn();
  csrfProtection(fakeRequest(tokens), {}, next);
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0];
};

describe('tokensMatch', () => {
  it('matches identical tokens', () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
  });

  it('rejects tokens of equal length that differ', () => {
    const other = `${TOKEN.slice(0, -1)}f`;
    expect(other).toHaveLength(TOKEN.length);
    expect(other).not.toBe(TOKEN);
    expect(tokensMatch(TOKEN, other)).toBe(false);
  });

  it('rejects tokens of different lengths without throwing', () => {
    expect(() => tokensMatch(TOKEN, TOKEN.slice(0, 10))).not.toThrow();
    expect(tokensMatch(TOKEN, TOKEN.slice(0, 10))).toBe(false);
    expect(tokensMatch(TOKEN, '')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(tokensMatch(TOKEN, undefined)).toBe(false);
    expect(tokensMatch(undefined, TOKEN)).toBe(false);
  });
});

describe('csrfProtection on a cookie-authenticated write', () => {
  it('lets a matching header through', () => {
    expect(run({ cookieToken: TOKEN, headerToken: TOKEN })).toBeUndefined();
  });

  it('refuses a same-length header that differs', () => {
    const err = run({ cookieToken: TOKEN, headerToken: `${TOKEN.slice(0, -1)}f` });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(errorManagement.commonErrors.authorizationError.code);
  });

  it('refuses a header of a different length (no 500)', () => {
    const err = run({ cookieToken: TOKEN, headerToken: TOKEN.slice(0, 8) });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(errorManagement.commonErrors.authorizationError.code);
  });

  it('refuses when the header is missing', () => {
    const err = run({ cookieToken: TOKEN, headerToken: undefined });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(errorManagement.commonErrors.authorizationError.code);
  });
});
