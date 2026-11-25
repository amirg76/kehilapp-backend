import pkg from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import {
  getUserByEmailForLoginFromDb,
  getUserByEmailFromDb,
  createUserInDb,
  buildRegistrationUser,
  getUserByVerificationTokenHashFromDb,
  markEmailVerifiedInDb,
  replacePendingRegistrationInDb,
  setPasswordResetTokenInDb,
  resetPasswordWithTokenInDb,
  getUserFromDb,
} from '../../users/dataAccess/userRepository.js';
import { getJwtSecret } from '../../../config/env.js';
import crypto from 'crypto';
import logger from '../../../services/logger.js';
import { sendVerificationEmail, sendAccountExistsEmail, sendPasswordResetEmail } from '../../../services/mailer.js';
import { mayExposeVerificationLink } from '../../../config/environment.js';
import { AUTH_COOKIE, CSRF_COOKIE, authCookieOptions, csrfCookieOptions } from '../../../config/cookies.js';

const { sign } = pkg;

// Short enough that a stolen token expires on its own, long enough that a
// session survives a working day.
const TOKEN_TTL = '12h';

// A verification link is a slow, human-in-the-loop step — a day is generous and
// still bounds how long a leaked link stays usable.
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const BCRYPT_COST = 12;

// The hash a login is checked against when no user has that email. It must be
// a REAL bcrypt hash at the same cost as the stored ones (register and
// scripts/seedDemo.js both use 12): bcryptjs answers a malformed hash at once.
// The old placeholder was 66 characters, so an unknown email was answered in
// about 20 ms and a registered one in 300+ (live backend log, 22.11.2026).
// Built on first use, not at import, so every test file that imports the app
// does not pay for a cost-12 hash it may never need; src/index.js builds it
// right after the server starts listening.
// A failed build is not kept: a cached rejection would make every unknown-email
// login a 500 while registered ones stay 401, the same leak by another route.
let dummyHashPromise;
export const dummyPasswordHash = () => {
  dummyHashPromise ??= bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_COST).catch((err) => {
    dummyHashPromise = undefined;
    throw err;
  });
  return dummyHashPromise;
};

// Anything that is not a well-formed bcrypt hash (always 60 characters) is
// answered at once by bcryptjs, so it gets the dummy too. Only corrupt rows
// can hit this (the schema requires a hash and every writer uses bcrypt).
const BCRYPT_HASH_LENGTH = 60;

const unauthorized = () =>
  new AppError(
    errorManagement.commonErrors.authenticationError.message,
    errorManagement.commonErrors.authenticationError.code,
    true,
  );

// We store only the hash of the verification token; the raw token lives only in
// the email link. sha256 is the right tool here (not bcrypt): the token is
// already high-entropy random, so there is nothing to slow-hash against.
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Mints a raw verification token plus the fields we persist for it. */
const mintVerificationToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    emailVerificationTokenHash: sha256(token),
    emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL_MS),
  };
};

export const login = async (req, res, next) => {
  const { email, password } = req.body;

  const user = await getUserByEmailForLoginFromDb(email);

  // Compare against a dummy hash when the user is missing so that a wrong email
  // and a wrong password take the same time. Otherwise the response time alone
  // tells an attacker which addresses are registered.
  const stored = user?.passwordHash;
  const hash = typeof stored === 'string' && stored.length === BCRYPT_HASH_LENGTH ? stored : await dummyPasswordHash();
  const passwordMatches = await bcrypt.compare(password, hash);

  // One generic error for every refusal: no such address, wrong password, and
  // an address never verified.
  //
  // THE LAST ONE USED TO BE A 403 "Email not verified" (until 25.11.2026), and
  // that told a stranger who is a verified member. Register with the address
  // and a password of your own, then log in with that password: a new or
  // pending address now holds your password and answered 403; a verified
  // member's account is untouched by register (authController.register) and
  // answered 401. One register and one login per address, no email to the
  // owner needed. The 403 was there so a real owner would know to check their
  // inbox; the login page now offers "send the verification email again" on
  // every refusal instead, and that answer is the same for every address.
  if (!user || !passwordMatches || !user.emailVerified) {
    return next(unauthorized());
  }

  // The auth middleware requires both claims; a token missing `role` is rejected.
  // `pwv`: the password version this session belongs to; a reset bumps it and
  // the middleware then refuses this token (see middlewares/auth.js).
  const token = sign({ id: user.id, role: user.role, pwv: user.passwordVersion ?? 0 }, getJwtSecret(), {
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
  });

  // A random CSRF token paired with this session (see middlewares/csrf.js).
  const csrfToken = crypto.randomBytes(32).toString('hex');

  // The JWT goes in an httpOnly cookie the browser sends automatically, so JS —
  // and therefore an XSS — can no longer read it. The CSRF token goes in a
  // readable cookie the SPA echoes back in a header.
  res.cookie(AUTH_COOKIE, token, authCookieOptions());
  res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());

  // The token is still returned in the body during the transition so existing
  // Bearer-header clients keep working; new clients ignore it and rely on the
  // cookie. `csrfToken` is echoed for convenience (also available via cookie).
  return res.status(200).json({
    token,
    csrfToken,
    // `approved` rides along so the resident app can show a "waiting for
    // approval" banner and the admin dashboard can list who is still pending.
    // It is NOT a token claim: see the comment in middlewares/auth.js.
    user: { id: user.id, name: user.name, email: user.email, role: user.role, approved: user.approved === true },
  });
};

/**
 * The identity behind the current cookie.
 *
 * A session lives in an httpOnly cookie, which is the point — JS cannot read it.
 * The consequence is that after a page reload the SPA holds a valid session it
 * has no way to inspect: it knows neither who it is nor whether the cookie has
 * expired. Without this endpoint a client must either keep a second, readable
 * copy of the identity (which an XSS can forge) or show a login screen to an
 * already-signed-in user on every refresh.
 *
 * `auth` has already verified the token AND confirmed the account still exists,
 * so reaching this handler at all is the answer; a stale or revoked session gets
 * a 401 from the middleware and never arrives here.
 */
export const me = async (req, res, next) => {
  const user = await getUserFromDb(req.userId);

  // Defensive: `auth` looked the user up a moment ago, so this is unreachable in
  // practice. It exists so a future change to the middleware cannot turn a
  // missing account into a 500 or a null-shaped 200.
  if (!user) {
    return next(unauthorized());
  }

  return res.status(200).json({
    // Read fresh from the document on every call, so an approval granted after
    // login shows up here without the client signing in again.
    user: { id: user.id, name: user.name, email: user.email, role: user.role, approved: user.approved === true },
  });
};

export const logout = async (req, res) => {
  // Clearing requires the same attributes the cookies were set with.
  res.clearCookie(AUTH_COOKIE, { ...authCookieOptions(), maxAge: undefined });
  res.clearCookie(CSRF_COOKIE, { ...csrfCookieOptions(), maxAge: undefined });
  return res.status(200).json({ ok: true });
};

/** Mints a new token for an unverified account, saves it, and emails the link. */
const refreshVerification = async (user) => {
  const { token, emailVerificationTokenHash, emailVerificationExpires } = mintVerificationToken();
  user.emailVerificationTokenHash = emailVerificationTokenHash;
  user.emailVerificationExpires = emailVerificationExpires;
  await user.save();
  return sendVerificationEmail({ email: user.email, token });
};

/**
 * A registration for an address whose account was opened but never verified
 * REPLACES that pending registration: the new name and password, a new token
 * (the old link stops working), and a verification email (24.11.2026).
 *
 * Safe only because verify-email asks for the password. Whoever registers
 * last owns the pending password, but only the inbox's owner gets the link, so
 * the account is activated only by someone holding both: the owner, after
 * registering themselves. A stranger who registers with someone's address can
 * no longer have it activated by the owner clicking a link (pre-hijacking),
 * and can no longer keep the address for good, because the owner's own
 * registration replaces theirs. An unverified account cannot log in or be
 * approved (usersController), so nothing else is attached to it.
 *
 * One conditional update, not load-then-save (see userRepository.js): if the
 * account was verified after it was read, nothing is written and this returns
 * null, and the caller treats it as the verified account it now is.
 */
const replacePendingRegistration = (existing, fields) => replacePendingRegistrationInDb(existing._id, fields);

/**
 * Self-registration. Creates an unverified `member` account and emails (or, in
 * dev/test, logs) a verification link. The account cannot log in until it is
 * verified — see the emailVerified check in `login`.
 *
 * A TAKEN ADDRESS GETS THE SAME ANSWER AS A NEW ONE (24.11.2026). It used to
 * be a 409, which told anyone with a list of addresses who is a member, one
 * request each. Now the page always says "check your inbox", and the inbox
 * tells the real owner what happened: a verified account's owner gets "you
 * already have an account"; a pending one is replaced and gets a new link (see
 * replacePendingRegistration). Every path hashes a password and sends one
 * email, so they also take about the same time. The mail caps sit on the route
 * (authRoutes.js).
 *
 * Existence is still not pre-checked: the insert is tried and the unique index
 * decides, so two registrations racing for one address both land here safely.
 */
export const register = async (req, res) => {
  const { name, email, password } = req.body;

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const { token, emailVerificationTokenHash, emailVerificationExpires } = mintVerificationToken();
  const fields = {
    // A display name is optional at registration; fall back to the local-part of
    // the address so `name` (required by the schema) is always satisfied.
    name: name || email.split('@')[0],
    email,
    passwordHash,
    emailVerificationTokenHash,
    emailVerificationExpires,
  };

  let user;
  let existing = null;
  try {
    user = await createUserInDb(fields);
  } catch (err) {
    // Only "this address is taken" is answered as a success. The lookup, not
    // the error's shape, decides: Mongo's duplicate-key error reaches here as
    // code 11000 or, through the schema hook, as an AppError.
    existing = await getUserByEmailFromDb(email);
    if (!existing) throw err;
    // The answer is built from an unsaved document with a fresh id, never from
    // `existing`: its id would be the same on every attempt for that address,
    // and a repeat would tell a stranger the address is taken.
    user = buildRegistrationUser(fields);
  }

  const replaced =
    existing && existing.emailVerified !== true ? await replacePendingRegistration(existing, fields) : null;
  const mail =
    existing && !replaced
      ? await sendAccountExistsEmail({ email: existing.email })
      : await sendVerificationEmail({ email: existing?.email ?? user.email, token });

  const body = {
    id: user.id,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    // A brand-new account is never approved: verifying the address is a step
    // towards membership, not membership itself. Read from the DOCUMENT rather
    // than written as a literal `false`, so register, login and /me all report
    // the same field from the same source and none of the three can drift if the
    // schema default or createUserInDb ever changes.
    approved: user.approved,
    // Whether a message actually left the building. The client used to infer this
    // from the presence of the token and, with no provider configured, always
    // concluded "sent" — so a failed send and a successful one both rendered
    // "check your inbox" for an inbox nothing was sent to. A boolean says it
    // outright and reveals nothing.
    emailDelivered: mail.delivered === true,
  };
  // The raw token travels in the response body ONLY under the two explicit
  // conditions in mayExposeVerificationLink(). It used to travel whenever no real
  // mail was delivered, which — since the default transport delivers nothing —
  // meant always: registering with someone else's address returned the token that
  // verifies that address. `!mail.delivered` stays as a third condition because
  // echoing a token that was genuinely emailed is pointless as well as unsafe.
  // (Development only: a taken, verified address has no token to echo, so there
  // the answers differ. mayExposeVerificationLink() is never true in
  // production.)
  if (!mail.delivered && mayExposeVerificationLink() && mail.token) {
    body.verificationToken = mail.token;
    body.verificationLink = mail.link;
  }

  return res.status(201).json(body);
};

/**
 * Confirms an address from the token in the emailed link, AND the password
 * chosen at registration. Marks the account verified and clears the one-time
 * token so the link cannot be replayed.
 *
 * A wrong, already-used, or expired token all yield the same generic 400 — the
 * lookup is by hash and scoped to unexpired tokens, so a miss reveals nothing.
 *
 * WHY THE PASSWORD (24.11.2026). The link proves only that someone reads the
 * inbox. A stranger could register first with a resident's address and the
 * stranger's own password; the resident, clicking "verify" in a genuine email,
 * activated that account, and the stranger then logged in as the resident. Now
 * the account is activated only by someone who has the link AND the password.
 *
 * A wrong password is a 403, not 401 (the front clears its session on any
 * 401), and it does not spend the token: only the inbox's owner has the token,
 * so a retry is theirs, and registerLimiter counts the failures.
 */
export const verifyEmail = async (req, res, next) => {
  const { token, password } = req.body;

  const invalidLink = () =>
    next(new AppError('Invalid or expired verification token.', errorManagement.commonErrors.badRequest.code, true));

  const tokenHash = sha256(token);
  const user = await getUserByVerificationTokenHashFromDb(tokenHash);
  if (!user) return invalidLink();

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    return next(
      new AppError('Wrong password for this account.', errorManagement.commonErrors.authorizationError.code, true),
    );
  }

  // Written only if the account still holds THIS token. A registration for
  // the address while bcrypt ran replaced the token together with the
  // password just checked, so the link is no longer good (see userRepository).
  if (!(await markEmailVerifiedInDb(user._id, tokenHash))) return invalidLink();

  return res.status(200).json({ ok: true, emailVerified: true });
};

/**
 * Re-sends a verification link. The response is deliberately uniform whether or
 * not the address exists (or is already verified): confirming which addresses
 * are registered is exactly the enumeration leak the generic login error avoids.
 * A fresh token is minted so any previously leaked link is superseded.
 */
export const resendVerification = async (req, res) => {
  const { email } = req.body;

  const user = await getUserByEmailFromDb(email);
  let devHint;

  if (user && !user.emailVerified) {
    if (mayExposeVerificationLink()) {
      // Development only: the link comes back in the body, so wait for it.
      const mail = await refreshVerification(user);
      // Same two explicit conditions as register. This endpoint was the worse of
      // the two leaks: it takes an address and nothing else, so it handed out a
      // verification token for any unverified account without even registering.
      if (!mail.delivered) devHint = { verificationToken: mail.token, verificationLink: mail.link };
    } else {
      // The answer does NOT wait for the email (24.11.2026). Only this branch
      // sends one, and a send to the mail provider takes hundreds of ms, so
      // waiting for it told a stranger "registered and not yet verified" by
      // the clock alone, whatever the body said. The token is saved and the
      // mail sent after the response; a failure is logged, and the caller
      // retries as they would for a lost email.
      refreshVerification(user).catch((err) => logger.error(`[auth] resend-verification failed: ${err.name}`));
    }
  }

  // Always 200, always the same message.
  //
  // NOTE THE ASYMMETRY WITH register(): that endpoint reports `emailDelivered`,
  // and this one deliberately does not. Delivery can only be attempted for an
  // address that exists and is unverified, so the boolean would answer precisely
  // the question this uniform response exists to refuse. A caller who gets no
  // mail retries; a caller who gets an oracle enumerates the member list.
  return res.status(200).json({
    ok: true,
    message: 'If the address exists and is unverified, a verification email has been sent.',
    ...(devHint || {}),
  });
};

// A reset link is meant to be used now, by someone holding the inbox: an hour.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** The work behind "forgot password", done after the answer has gone out. */
const startPasswordReset = async (email) => {
  const user = await getUserByEmailFromDb(email);
  // Only a verified account. A pending one needs no reset: registering again
  // replaces it (see register). Unknown address: nothing at all.
  if (!user || user.emailVerified !== true) return;
  const token = crypto.randomBytes(32).toString('hex');
  const stored = await setPasswordResetTokenInDb(user._id, {
    passwordResetTokenHash: sha256(token),
    passwordResetExpires: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });
  if (stored) await sendPasswordResetEmail({ email: user.email, token });
};

/**
 * "Forgot password" (25.11.2026). Always the same 200 and the same body, and it
 * answers BEFORE anything is looked up or sent: the same rule as
 * resend-verification, where waiting for the mail provider told a stranger who
 * is registered by the clock alone. The mail caps sit on the route.
 *
 * Never a token in the body, not even in development: a reset link changes a
 * password, and there is no flow that needs one without the inbox.
 */
export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  startPasswordReset(email).catch((err) => logger.error(`[auth] forgot-password failed: ${err.name}`));
  return res.status(200).json({
    ok: true,
    message: 'If the address belongs to a verified account, a password reset link has been sent.',
  });
};

/**
 * Sets a new password from the emailed link. The password is hashed BEFORE the
 * token is looked up, so a bad link costs the same time as a good one.
 *
 * The token check, the new password and spending the token are one conditional
 * write (resetPasswordWithTokenInDb): a link works once, and two requests with
 * it cannot both succeed. passwordChangedAt ends every earlier session.
 */
export const resetPassword = async (req, res, next) => {
  const { token, password } = req.body;
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const user = await resetPasswordWithTokenInDb(sha256(token), passwordHash);
  if (!user) {
    return next(new AppError('Invalid or expired reset token.', errorManagement.commonErrors.badRequest.code, true));
  }
  return res.status(200).json({ ok: true });
};
