/**
 * What the classify limiter counts against.
 *
 * WHY THIS FILE EXISTS. `/api/messages/classify` is the only route in this API
 * that spends money, and three separate things keep that spend bounded: the
 * admin-only guard, the SDK's retry count, and this limiter's key. The first two
 * gained tests when they were fixed; this one did not, and a review caught that
 * deleting the `keyGenerator` line left all 260 tests green while the limiter
 * silently reverted to counting per IP address. Per-address counting fails in
 * both directions at once — one caller who changes address gets a fresh budget
 * every time, and a whole office behind one NAT shares a single budget — so the
 * regression is not a smaller limit or a bigger one, it is an unpredictable one.
 */
import { classifyRateKey } from '../middlewares/rateLimit.js';

describe('classifyRateKey — what the paid endpoint counts against', () => {
  it('counts against the account, not the address', () => {
    // The case the limiter exists for: one signed-in caller stays one bucket no
    // matter where the request comes from.
    const first = classifyRateKey({ userId: 'user-1', ip: '203.0.113.5' });
    const second = classifyRateKey({ userId: 'user-1', ip: '198.51.100.9' });

    expect(first).toBe('user-1');
    expect(second).toBe('user-1');
  });

  it('gives two admins behind one address two separate budgets', () => {
    // The NAT case. Keyed on the address, one admin exhausting the budget would
    // lock out every colleague in the same building.
    const a = classifyRateKey({ userId: 'user-1', ip: '203.0.113.5' });
    const b = classifyRateKey({ userId: 'user-2', ip: '203.0.113.5' });

    expect(a).not.toBe(b);
  });

  it('does not let one account buy a new budget by changing IPv6 address', () => {
    // The mirror-image failure, and the more expensive one: an IPv6 caller holds
    // an entire /64, so a raw-address key would hand out a fresh 30 billed calls
    // for every address they pick out of it.
    const key = classifyRateKey({ userId: 'user-1', ip: '2001:db8::dead:beef' });
    const sameUserElsewhere = classifyRateKey({ userId: 'user-1', ip: '2001:db8::1' });

    expect(key).toBe(sameUserElsewhere);
  });

  it('falls back to a subnet-normalised address when there is no account', () => {
    // Unreachable in production while `auth` precedes the limiter on the route —
    // asserted anyway, because the fallback is what runs if that order is ever
    // changed, and a fallback that returned undefined would put every anonymous
    // caller in ONE shared bucket.
    const v4 = classifyRateKey({ ip: '203.0.113.5' });
    expect(typeof v4).toBe('string');
    expect(v4.length).toBeGreaterThan(0);

    // Two addresses out of the same /64 must collapse to one key, or the
    // fallback reintroduces exactly the hole it is standing in for.
    const v6a = classifyRateKey({ ip: '2001:db8::dead:beef' });
    const v6b = classifyRateKey({ ip: '2001:db8::1' });
    expect(v6a).toBe(v6b);

    // A different network must NOT collapse into it.
    expect(classifyRateKey({ ip: '2001:db9::1' })).not.toBe(v6a);
  });
});
