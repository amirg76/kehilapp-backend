import pkg from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import {
  getUserByEmailForLoginFromDb,
  getUserByEmailFromDb,
  createUserInDb,
  getUserByVerificationTokenHashFromDb,
  getUserFromDb,
} from '../../users/dataAccess/userRepository.js';
import { getJwtSecret } from '../../../config/env.js';
import crypto from 'crypto';
import { sendVerificationEmail } from '../../../services/mailer.js';
import { AUTH_COOKIE, CSRF_COOKIE, authCookieOptions, csrfCookieOptions } from '../../../config/cookies.js';

const { sign } = pkg;

// Short enough that a stolen token expires on its own, long enough that a
// session survives a working day.
const TOKEN_TTL = '12h';

// A verification link is a slow, human-in-the-loop step — a day is generous and
// still bounds how long a leaked link stays usable.
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const BCRYPT_COST = 12;

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
  const hash = user?.passwordHash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const passwordMatches = await bcrypt.compare(password, hash);

  // One generic error for both cases — never reveal which half was wrong.
  if (!user || !passwordMatches) {
    return next(unauthorized());
  }

  // Credentials are correct but the address was never confirmed. This check runs
  // AFTER the password check on purpose: revealing "email not verified" before
  // proving the password would tell an attacker the address is registered. A
  // clear 403 (not the generic 401) so a real owner knows to check their inbox.
  if (!user.emailVerified) {
    return next(
      new AppError(
        'Email not verified. Please verify your email address before signing in.',
        errorManagement.commonErrors.authorizationError.code,
        true,
      ),
    );
  }

  // The auth middleware requires both claims; a token missing `role` is rejected.
  const token = sign({ id: user.id, role: user.role }, getJwtSecret(), {
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

/**
 * Self-registration. Creates an unverified `member` account and emails (or, in
 * dev/test, logs) a verification link. The account cannot log in until it is
 * verified — see the emailVerified check in `login`.
 *
 * A duplicate email surfaces as the unique-index violation on create, which the
 * error pipeline maps to 409 (see errorHandlers). We do NOT pre-check existence
 * and branch on it, which would just be a second, racier way to the same 409.
 */
export const register = async (req, res) => {
  const { name, email, password } = req.body;

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const { token, emailVerificationTokenHash, emailVerificationExpires } = mintVerificationToken();

  const user = await createUserInDb({
    // A display name is optional at registration; fall back to the local-part of
    // the address so `name` (required by the schema) is always satisfied.
    name: name || email.split('@')[0],
    email,
    passwordHash,
    emailVerificationTokenHash,
    emailVerificationExpires,
  });

  const mail = await sendVerificationEmail({ email: user.email, token });

  // 201 Created. Never echo anything secret in production; only when the mailer
  // merely logged the link (no real provider — dev/test) do we hand the token
  // and link back so a local client or the test suite can complete the flow.
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
  };
  if (!mail.delivered) {
    body.verificationToken = mail.token;
    body.verificationLink = mail.link;
  }

  return res.status(201).json(body);
};

/**
 * Confirms an address from the token in the emailed link. Marks the account
 * verified and clears the one-time token so the link cannot be replayed.
 *
 * A wrong, already-used, or expired token all yield the same generic 400 — the
 * lookup is by hash and scoped to unexpired tokens, so a miss reveals nothing.
 */
export const verifyEmail = async (req, res, next) => {
  const { token } = req.body;

  const user = await getUserByVerificationTokenHashFromDb(sha256(token));
  if (!user) {
    return next(
      new AppError('Invalid or expired verification token.', errorManagement.commonErrors.badRequest.code, true),
    );
  }

  user.emailVerified = true;
  user.emailVerificationTokenHash = undefined;
  user.emailVerificationExpires = undefined;
  await user.save();

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
    const { token, emailVerificationTokenHash, emailVerificationExpires } = mintVerificationToken();
    user.emailVerificationTokenHash = emailVerificationTokenHash;
    user.emailVerificationExpires = emailVerificationExpires;
    await user.save();

    const mail = await sendVerificationEmail({ email: user.email, token });
    // Same dev/test convenience as register: only exposed when nothing was
    // actually delivered by a real provider.
    if (!mail.delivered) devHint = { verificationToken: mail.token, verificationLink: mail.link };
  }

  // Always 200, always the same message.
  return res.status(200).json({
    ok: true,
    message: 'If the address exists and is unverified, a verification email has been sent.',
    ...(devHint || {}),
  });
};
