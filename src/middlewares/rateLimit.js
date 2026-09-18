import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import AppError from '../errors/AppError.js';
import errorManagement from '../errors/utils/errorManagement.js';

const tooManyRequests = () =>
  new AppError(
    errorManagement.commonErrors.tooManyRequests.message,
    errorManagement.commonErrors.tooManyRequests.code,
    true,
  );

/** Route the limiter's rejection through the app's own error pipeline. */
const handler = (req, res, next) => next(tooManyRequests());

/**
 * Broad ceiling for the whole API. Generous on purpose — this exists to blunt
 * scripted abuse, not to get in a real user's way.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/**
 * Login is the endpoint worth actually protecting: without a limit here, the
 * password check is an open guessing oracle.
 *
 * `skipSuccessfulRequests` means a person who logs in correctly never spends
 * from this budget, so the limit only ever bites on repeated failures.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/**
 * Registration and email-verification limiter.
 *
 * Separate from loginLimiter on purpose. The login limit exists to stop password
 * guessing, so it is deliberately tight (10 failures / 15 min). Applying that same
 * budget to /api/auth/* also throttled REGISTRATION — a person filling in a signup
 * form a few times (typo, mismatched password, re-reading the rules) would hit the
 * wall and see a generic failure. Signup is not a guessing oracle; it needs abuse
 * protection, not a brute-force lock.
 *
 * Successful requests are not counted, so an ordinary user never spends the budget.
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/**
 * Limiter for the AI classification endpoint.
 *
 * A different threat model from every limiter above. Those exist to stop abuse
 * of an endpoint that is otherwise free to serve: the worst case is database
 * work and a guessed password. Here every call is a billed request to an outside
 * API, so the worst case is a bill — and the caller does not even have to be
 * hostile to run one up. An admin panel that re-classifies on each keystroke, a
 * retry loop, a stuck tab: any of those spends real money at whatever rate the
 * loop runs at, with no upper bound anywhere else in the stack.
 *
 * `skipSuccessfulRequests` is deliberately NOT set, which is the exact opposite
 * of loginLimiter. There, only failures are the threat, so a legitimate user
 * never spends from the budget. Here the SUCCESSFUL calls are the ones that
 * cost, so excluding them would exempt the entire thing this limit is for and
 * leave a limiter that only counts requests which were already refused.
 *
 * 30 in 15 minutes is a ceiling on a runaway client, not a quota on an admin:
 * writing 30 notices in a quarter of an hour is not something a person does.
 */
/**
 * The bucket a classify request is counted against.
 *
 * Named and exported for ONE reason: to be testable. Inline inside the
 * `rateLimit({...})` options it was the only one of this feature's three cost
 * controls with no test behind it — deleting the line left the whole suite green
 * while silently reverting to per-address counting. A limiter whose key nobody
 * can assert on is a limiter nobody can keep.
 *
 * Not exported for reuse: no other limiter should adopt this, because no other
 * limiter runs behind `auth`.
 */
export const classifyRateKey = (req) => req.userId ?? ipKeyGenerator(req.ip);

export const classifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  // Counted per ACCOUNT, not per address — the only limiter here that needs to
  // be. Every other limiter guards an endpoint anyone may reach, so the address
  // is the only identity available at the time it runs. This one sits behind
  // `auth`, so `req.userId` is already resolved, and the difference is the whole
  // limit: an address is something a caller can change (a new IPv6 address from
  // the same /64, a phone leaving wifi, any proxy) and each change hands out a
  // fresh budget of 30 billed calls, while a single office NAT would make every
  // admin in the building share one. Keying on the account inverts both.
  //
  // The IPv4/IPv6 fallback is not decoration: `req.ip` for an IPv6 caller is a
  // single address out of a /64 the caller holds entirely, so using it raw is
  // the "new address, new budget" hole above. `ipKeyGenerator` normalises to the
  // subnet. It is unreachable while `auth` precedes this limiter and is kept as
  // the safe answer if that order is ever changed.
  keyGenerator: classifyRateKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});
