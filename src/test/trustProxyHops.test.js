/**
 * TRUST_PROXY_HOPS: what the server accepts, what it refuses (unit).
 *
 * The number feeds Express's `trust proxy` directly. Too few hops and every
 * client resolves to the last proxy (one shared rate-limit bucket); too many
 * and a caller can pad X-Forwarded-For and pick their own address. So the
 * accepted range is small on purpose, and anything else stops the boot.
 */
import { trustProxyHops, assertTrustProxyHops } from '../config/environment.js';

let saved;

beforeEach(() => {
  saved = process.env.TRUST_PROXY_HOPS;
});

afterEach(() => {
  if (saved === undefined) delete process.env.TRUST_PROXY_HOPS;
  else process.env.TRUST_PROXY_HOPS = saved;
});

describe('trustProxyHops', () => {
  it('is 1 when unset — one proxy, the pre-existing behaviour', () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect(trustProxyHops()).toBe(1);
  });

  it('is the configured number', () => {
    process.env.TRUST_PROXY_HOPS = '2';
    expect(trustProxyHops()).toBe(2);
  });
});

describe('assertTrustProxyHops', () => {
  it.each(['0', '1', '2', '5'])('accepts %p', (value) => {
    process.env.TRUST_PROXY_HOPS = value;
    expect(() => assertTrustProxyHops()).not.toThrow();
  });

  it('accepts unset', () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect(() => assertTrustProxyHops()).not.toThrow();
  });

  it('treats whitespace as unset — default 1, no refusal', () => {
    process.env.TRUST_PROXY_HOPS = '  ';
    expect(() => assertTrustProxyHops()).not.toThrow();
    expect(trustProxyHops()).toBe(1);
  });

  it.each(['true', '6', '20', '-1', '1.5', 'abc', '0x2'])('refuses %p and says why', (value) => {
    process.env.TRUST_PROXY_HOPS = value;
    expect(() => assertTrustProxyHops()).toThrow(/from 0 to 5/);
  });
});
