/**
 * `npm run prod` sets NODE_ENV=prod, not 'production'.
 *
 * Four separate places asked `process.env.NODE_ENV === 'production'` by hand, and
 * all four were therefore FALSE under this project's own production command. Two
 * of them were live security weaknesses: the session cookie lost its `secure`
 * flag, and localhost stayed on the CORS allowlist next to
 * Allow-Credentials: true.
 *
 * config/environment.js answers the question once. These tests pin the helper and
 * then pin each call site that depends on it, under NODE_ENV=prod specifically —
 * the spelling that used to slip through. The two destructive scripts are the
 * other two call sites; they are proved by exit code in
 * src/test/seedDemoGuard.test.js and src/test/approveExistingUsers.int.test.js,
 * because for a script the exit code IS the contract.
 */
import { isProduction, isKnownNonProduction, nodeEnvName, assertKnownEnvironment } from '../config/environment.js';
import { authCookieOptions, csrfCookieOptions } from '../config/cookies.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const withEnv = (vars) => {
  Object.entries(vars).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
};

describe('config/environment.js treats `prod` and `production` alike', () => {
  it.each(['production', 'prod', 'PROD', 'Production', '  prod  '])('calls %p production', (value) => {
    withEnv({ NODE_ENV: value });
    expect(isProduction()).toBe(true);
    expect(isKnownNonProduction()).toBe(false);
  });

  it.each(['local', 'dev', 'development', 'test'])('calls %p a known non-production environment', (value) => {
    withEnv({ NODE_ENV: value });
    expect(isProduction()).toBe(false);
    expect(isKnownNonProduction()).toBe(true);
  });

  it('answers NEITHER question yes for a value it does not recognise', () => {
    // The whole point of two lists rather than one negation: 'staging' is not
    // production, and it is not a known development environment either. A caller
    // about to do something irreversible asks isKnownNonProduction and refuses.
    withEnv({ NODE_ENV: 'staging' });
    expect(isProduction()).toBe(false);
    expect(isKnownNonProduction()).toBe(false);
  });

  it('answers neither question yes when NODE_ENV is unset', () => {
    withEnv({ NODE_ENV: undefined });
    expect(isProduction()).toBe(false);
    expect(isKnownNonProduction()).toBe(false);
    expect(nodeEnvName()).toBe('(unset)');
  });
});

describe('config/cookies.js — the session cookie under NODE_ENV=prod', () => {
  it('sets secure on the auth cookie', () => {
    withEnv({ NODE_ENV: 'prod', COOKIE_SECURE: undefined, COOKIE_SAMESITE: undefined });
    // Before the fix this was false: `npm run prod` shipped the session cookie
    // over a deployment that is supposed to be HTTPS, without Secure.
    expect(authCookieOptions().secure).toBe(true);
    expect(csrfCookieOptions().secure).toBe(true);
  });

  it('sets secure under NODE_ENV=production too', () => {
    withEnv({ NODE_ENV: 'production', COOKIE_SECURE: undefined, COOKIE_SAMESITE: undefined });
    expect(authCookieOptions().secure).toBe(true);
  });

  it('leaves local http development alone', () => {
    withEnv({ NODE_ENV: 'local', COOKIE_SECURE: undefined, COOKIE_SAMESITE: undefined });
    expect(authCookieOptions().secure).toBe(false);
  });

  it('keeps secure on for an environment it does not recognise — FAIL-CLOSED', () => {
    // This call site asks isKnownNonProduction(), not isProduction(). The
    // difference is the whole point: isProduction() answers FALSE for 'staging',
    // for a typo and for an unset NODE_ENV, and the false branch drops `secure`.
    // src/index.js now refuses to boot on such a value, but this module is also
    // imported directly — by this very test — so it does not rely on that.
    withEnv({ NODE_ENV: 'staging', COOKIE_SECURE: undefined, COOKIE_SAMESITE: undefined });
    expect(authCookieOptions().secure).toBe(true);

    withEnv({ NODE_ENV: undefined, COOKIE_SECURE: undefined, COOKIE_SAMESITE: undefined });
    expect(authCookieOptions().secure).toBe(true);
    expect(csrfCookieOptions().secure).toBe(true);
  });

  it('still lets COOKIE_SECURE turn the flag off explicitly', () => {
    withEnv({ NODE_ENV: 'prod', COOKIE_SECURE: 'false', COOKIE_SAMESITE: undefined });
    expect(authCookieOptions().secure).toBe(false);
  });
});

/**
 * COOKIE_SECURE used to be read as `=== 'true'`, so it accepted exactly ONE
 * spelling and silently treated every other one — including every spelling that
 * obviously means "on" — as `false`. In production that quietly removed the
 * session cookie's Secure flag, with no error anywhere.
 *
 * This describe block replaces the single "still lets COOKIE_SECURE override
 * explicitly" case that used to pin the old behaviour as desired. That case
 * survives above (an explicit `false` is still honoured — it is the deliberate
 * opt-out for a developer on http); what has changed is everything around it.
 */
describe('config/cookies.js — COOKIE_SECURE is normalised, and a typo cannot disable it', () => {
  it.each(['true', 'TRUE', 'True', ' true ', '1', 'yes', 'Y', 'on', 'ON'])(
    'reads %p as ON, even where the environment says development',
    (value) => {
      withEnv({ NODE_ENV: 'local', COOKIE_SECURE: value, COOKIE_SAMESITE: undefined });
      expect(authCookieOptions().secure).toBe(true);
    },
  );

  it.each(['false', 'FALSE', ' false ', '0', 'no', 'N', 'off', 'OFF'])(
    'reads %p as OFF, even where the environment says production',
    (value) => {
      withEnv({ NODE_ENV: 'prod', COOKIE_SECURE: value, COOKIE_SAMESITE: undefined });
      expect(authCookieOptions().secure).toBe(false);
    },
  );

  it.each(['maybe', 'ture', 'enabled', 'si'])('THROWS on %p rather than reading it as false', (value) => {
    withEnv({ NODE_ENV: 'prod', COOKIE_SECURE: value, COOKIE_SAMESITE: undefined });
    expect(() => authCookieOptions()).toThrow(/COOKIE_SECURE/);
  });
});

/**
 * COOKIE_SAMESITE was lowercased but never trimmed. A trailing space in a .env
 * file — invisible in an editor, preserved by dotenv — reached the `cookie`
 * package as 'lax ', which it does not recognise; res.cookie() threw, and every
 * login and logout returned 500.
 */
describe('config/cookies.js — COOKIE_SAMESITE is trimmed and validated', () => {
  it.each([
    ['lax ', 'lax'],
    [' strict', 'strict'],
    ['  LAX  ', 'lax'],
    ['Strict', 'strict'],
  ])('reads %p as %p', (value, expected) => {
    withEnv({ NODE_ENV: 'local', COOKIE_SAMESITE: value, COOKIE_SECURE: undefined });
    expect(authCookieOptions().sameSite).toBe(expected);
  });

  it('still forces Secure on when SameSite is none, whitespace and all', () => {
    withEnv({ NODE_ENV: 'local', COOKIE_SAMESITE: ' none ', COOKIE_SECURE: undefined });
    expect(authCookieOptions().sameSite).toBe('none');
    expect(authCookieOptions().secure).toBe(true);
  });

  it('defaults to lax when unset or blank', () => {
    withEnv({ NODE_ENV: 'local', COOKIE_SAMESITE: undefined, COOKIE_SECURE: undefined });
    expect(authCookieOptions().sameSite).toBe('lax');

    withEnv({ NODE_ENV: 'local', COOKIE_SAMESITE: '   ', COOKIE_SECURE: undefined });
    expect(authCookieOptions().sameSite).toBe('lax');
  });

  it('THROWS on a value the cookie package would reject', () => {
    withEnv({ NODE_ENV: 'local', COOKIE_SAMESITE: 'laxx', COOKIE_SECURE: undefined });
    expect(() => authCookieOptions()).toThrow(/COOKIE_SAMESITE/);
  });
});

describe('config/environment.js — assertKnownEnvironment', () => {
  it.each(['local', 'dev', 'development', 'test', 'production', 'prod'])('accepts %p', (value) => {
    withEnv({ NODE_ENV: value });
    expect(() => assertKnownEnvironment()).not.toThrow();
  });

  it.each(['staging', 'prod-eu', 'Produciton', ''])('refuses %p', (value) => {
    withEnv({ NODE_ENV: value });
    expect(() => assertKnownEnvironment()).toThrow(/NODE_ENV=/);
  });

  it('refuses an unset NODE_ENV and names every value it would accept', () => {
    withEnv({ NODE_ENV: undefined });
    expect(() => assertKnownEnvironment()).toThrow(/\(unset\)/);
    expect(() => assertKnownEnvironment()).toThrow(/local, dev, development, test, production, prod/);
  });
});

describe('middlewares/cors.js — the allowlist under NODE_ENV=prod', () => {
  // The allowlist is built once, at module load, so each case re-imports the
  // module with the environment already in place.
  const loadCors = async () => {
    jest.resetModules();
    const mod = await import('../middlewares/cors.js');
    return mod.default;
  };

  /** Runs the middleware against one Origin and reports the headers it set. */
  const headersFor = (middleware, origin) => {
    const set = {};
    const res = {
      header: (name, value) => {
        set[name] = value;
      },
      sendStatus: () => {},
    };
    middleware({ get: (name) => (name === 'Origin' ? origin : undefined), method: 'GET' }, res, () => {});
    return set;
  };

  it('does not allow localhost a credentialed request under NODE_ENV=prod', async () => {
    withEnv({ NODE_ENV: 'prod', ALLOWED_ORIGINS: undefined });
    const middleware = await loadCors();

    const headers = headersFor(middleware, 'http://localhost:5173');
    // Before the fix both of these were set: any page on the developer's machine
    // could make credentialed cross-origin calls against the deployment.
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('does not allow it under NODE_ENV=production either', async () => {
    withEnv({ NODE_ENV: 'production', ALLOWED_ORIGINS: undefined });
    const middleware = await loadCors();

    expect(headersFor(middleware, 'http://localhost:3000')['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('does not allow it under an UNRECOGNISED NODE_ENV either — FAIL-CLOSED', async () => {
    // The fallback is gated on isKnownNonProduction(), not on !isProduction().
    // Under the old question 'staging' and an unset value both took the
    // development branch and put localhost back on the allowlist beside
    // Allow-Credentials: true.
    withEnv({ NODE_ENV: 'staging', ALLOWED_ORIGINS: undefined });
    const staging = await loadCors();
    expect(headersFor(staging, 'http://localhost:5173')['Access-Control-Allow-Origin']).toBeUndefined();

    withEnv({ NODE_ENV: undefined, ALLOWED_ORIGINS: undefined });
    const unset = await loadCors();
    const headers = headersFor(unset, 'http://localhost:5173');
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('keeps the dev fallback for a known development environment', async () => {
    withEnv({ NODE_ENV: 'development', ALLOWED_ORIGINS: undefined });
    const middleware = await loadCors();

    const headers = headersFor(middleware, 'http://localhost:5173');
    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('honours an explicit ALLOWED_ORIGINS under NODE_ENV=prod', async () => {
    withEnv({ NODE_ENV: 'prod', ALLOWED_ORIGINS: 'https://app.example.com' });
    const middleware = await loadCors();

    expect(headersFor(middleware, 'https://app.example.com')['Access-Control-Allow-Origin']).toBe(
      'https://app.example.com',
    );
    expect(headersFor(middleware, 'http://localhost:5173')['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
