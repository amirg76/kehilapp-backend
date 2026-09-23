/**
 * Where the verification link points, and who is allowed to see the token (unit).
 *
 * Two settings decide both, and both used to fail silently:
 *
 *  - APP_BASE_URL defaulted to this server's own origin, but `/verify-email` is a
 *    route in the React app — this server only exposes `POST
 *    /api/auth/verify-email`. The one link a recipient can click resolved to a
 *    host with no such route. Nothing caught it because nothing used it: the demo
 *    echoed the token back and the app built its own in-app link from that.
 *  - EXPOSE_VERIFICATION_LINK did not exist; the echo was conditioned on "no mail
 *    was delivered", which the default transport makes permanently true.
 *
 * Neither failure shows up on the machine that configures it. Both show up in a
 * stranger's inbox, or in their hands. So both are asserted here, on the pure
 * functions, in addition to the boot-time refusals in startupEnvironmentGuard.
 */
import { buildVerificationLink, assertVerificationLinkTarget, sendVerificationEmail } from '../services/mailer.js';
import { mayExposeVerificationLink, assertVerificationLinkExposureIsSafe } from '../config/environment.js';
import logger from '../services/logger.js';

const KEYS = ['APP_BASE_URL', 'EXPOSE_VERIFICATION_LINK', 'NODE_ENV', 'EMAIL_PROVIDER', 'RESEND_API_KEY'];

let saved;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  jest.restoreAllMocks();
});

/**
 * The server log is the other place a token can leak. The response-body gate
 * alone would have moved the hole rather than closed it: the log transport runs
 * in production every time the provider fails, and a log line with the token
 * lets whoever reads the logs verify that account.
 */
describe('the verification link in the server log', () => {
  // Distinctive and hex-shaped like a real one, so a partial leak is still caught.
  const TOKEN = 'feedfacecafebeef0123456789abcdef';

  const loggedLine = async () => {
    const spy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    await sendVerificationEmail({ email: 'someone@test.example.com', token: TOKEN });
    const lines = spy.mock.calls.map(([line]) => String(line)).filter((l) => l.includes('[mailer]'));
    expect(lines).toHaveLength(1);
    return lines[0];
  };

  it('keeps the full link in development, where the log is the only place it exists', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_PROVIDER = '';

    expect(await loggedLine()).toContain(`token=${TOKEN}`);
  });

  it('cuts the token out in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://kehilapp.example.com';
    process.env.EMAIL_PROVIDER = '';

    const line = await loggedLine();
    expect(line).toContain('token=<redacted>');
    expect(line).not.toContain(TOKEN);
    // Still useful to an operator: which address, and that a link was due.
    expect(line).toContain('someone@test.example.com');
  });

  it('cuts it on the provider-failure path too — the one that actually runs in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://kehilapp.example.com';
    // A provider is selected but unusable, so it falls back to the log transport.
    process.env.EMAIL_PROVIDER = 'resend';
    delete process.env.RESEND_API_KEY;

    const line = await loggedLine();
    expect(line).not.toContain(TOKEN);
    expect(line).toContain('RESEND_API_KEY is unset');
  });

  it('cuts it for an environment nobody named — fail closed', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.EMAIL_PROVIDER = '';

    expect(await loggedLine()).not.toContain(TOKEN);
  });
});

describe('buildVerificationLink', () => {
  it('points at the configured resident app, not at this server', () => {
    process.env.APP_BASE_URL = 'https://kehilapp.example.com';

    expect(buildVerificationLink('abc123')).toBe('https://kehilapp.example.com/verify-email?token=abc123');
  });

  it('falls back to the resident app dev port, not to this server port', () => {
    delete process.env.APP_BASE_URL;

    // 5180, the port both stack scripts serve the app on and the CORS allowlist
    // names. The old default was :5001 — this server — which 404s.
    expect(buildVerificationLink('abc123')).toBe('http://localhost:5180/verify-email?token=abc123');
  });

  it('does not double the slash when the configured origin ends in one', () => {
    process.env.APP_BASE_URL = 'https://kehilapp.example.com/';

    expect(buildVerificationLink('abc123')).toBe('https://kehilapp.example.com/verify-email?token=abc123');
  });

  it('percent-encodes the token so a link is never truncated by a token character', () => {
    process.env.APP_BASE_URL = 'https://kehilapp.example.com';

    expect(buildVerificationLink('a+b/c=d&e')).toBe(
      'https://kehilapp.example.com/verify-email?token=a%2Bb%2Fc%3Dd%26e',
    );
  });
});

describe('assertVerificationLinkTarget', () => {
  it('lets development run with nothing configured', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.APP_BASE_URL;

    expect(() => assertVerificationLinkTarget()).not.toThrow();
  });

  it('refuses an unset value in production, where the default would mail localhost to strangers', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_BASE_URL;

    expect(() => assertVerificationLinkTarget()).toThrow(/APP_BASE_URL is not set/);
  });

  it('refuses a bare hostname, which no mail client makes clickable', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'kehilapp.example.com';

    expect(() => assertVerificationLinkTarget()).toThrow(/absolute origin/);
  });

  it('refuses a non-http scheme', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'ftp://kehilapp.example.com';

    expect(() => assertVerificationLinkTarget()).toThrow(/http or https/);
  });

  it('accepts a configured https origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://kehilapp.example.com';

    expect(() => assertVerificationLinkTarget()).not.toThrow();
  });
});

describe('mayExposeVerificationLink', () => {
  it('is false in development until the flag is set by name', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EXPOSE_VERIFICATION_LINK;

    expect(mayExposeVerificationLink()).toBe(false);
  });

  it('is true only for the literal string "true"', () => {
    process.env.NODE_ENV = 'development';

    process.env.EXPOSE_VERIFICATION_LINK = '1';
    expect(mayExposeVerificationLink()).toBe(false);

    process.env.EXPOSE_VERIFICATION_LINK = 'TRUE';
    expect(mayExposeVerificationLink()).toBe(false);

    process.env.EXPOSE_VERIFICATION_LINK = 'true';
    expect(mayExposeVerificationLink()).toBe(true);
  });

  it('is false in production however loudly the flag is set', () => {
    process.env.EXPOSE_VERIFICATION_LINK = 'true';

    for (const name of ['production', 'prod']) {
      process.env.NODE_ENV = name;
      expect(mayExposeVerificationLink()).toBe(false);
    }
  });

  it('is false for an environment nobody named — it fails closed, not open', () => {
    process.env.EXPOSE_VERIFICATION_LINK = 'true';

    // `staging` and an unset value are recognised by neither list. This is why the
    // check is isKnownNonProduction() and not !isProduction(): the second would
    // answer "expose it" for both.
    for (const name of ['staging', '']) {
      process.env.NODE_ENV = name;
      expect(mayExposeVerificationLink()).toBe(false);
    }
  });
});

describe('assertVerificationLinkExposureIsSafe', () => {
  it('says nothing when the flag is absent, whatever the environment', () => {
    delete process.env.EXPOSE_VERIFICATION_LINK;

    for (const name of ['production', 'prod', 'staging', 'development']) {
      process.env.NODE_ENV = name;
      expect(() => assertVerificationLinkExposureIsSafe()).not.toThrow();
    }
  });

  it('allows the flag in a development environment', () => {
    process.env.EXPOSE_VERIFICATION_LINK = 'true';
    process.env.NODE_ENV = 'development';

    expect(() => assertVerificationLinkExposureIsSafe()).not.toThrow();
  });

  it('refuses the flag in production, rather than ignoring it silently', () => {
    process.env.EXPOSE_VERIFICATION_LINK = 'true';
    process.env.NODE_ENV = 'production';

    // mayExposeVerificationLink() already returns false here, so the server would
    // be SAFE and silently not doing what its own configuration says. The refusal
    // exists for the operator who sets this to fix a demo, sees no change, and
    // keeps escalating.
    expect(() => assertVerificationLinkExposureIsSafe()).toThrow(/development-only/);
  });

  it('refuses the flag in an environment nobody named', () => {
    process.env.EXPOSE_VERIFICATION_LINK = 'true';
    process.env.NODE_ENV = 'staging';

    expect(() => assertVerificationLinkExposureIsSafe()).toThrow(/NODE_ENV=staging/);
  });
});
