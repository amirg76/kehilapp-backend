import rateLimit from 'express-rate-limit';

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
