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
import { buildVerificationLink, assertVerificationLinkTarget } from '../services/mailer.js';
import { mayExposeVerificationLink, assertVerificationLinkExposureIsSafe } from '../config/environment.js';

const KEYS = ['APP_BASE_URL', 'EXPOSE_VERIFICATION_LINK', 'NODE_ENV'];

let saved;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
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
