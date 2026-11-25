import express from 'express';
import {
  loginValidation,
  registerValidation,
  verifyEmailValidation,
  resendVerificationValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
} from './authValidation.js';
import * as authController from '../domain/authController.js';
import auth from '../../../middlewares/auth.js';
import { mailSendLimiter, mailRecipientLimiter } from '../../../middlewares/rateLimit.js';

const router = express.Router();

// Public login. Listed explicitly in PUBLIC_ROUTES in
// src/test/routeAuthGuard.test.js; every other route must carry the auth
// middleware or the test suite fails.
router.post('/login', loginValidation, authController.login);

// Self-registration + email verification. All three are unauthenticated by
// necessity — the caller has no account yet, or is trying to activate one — and
// are listed in PUBLIC_ROUTES with a reason. They are also CSRF-exempt in
// middlewares/csrf.js: there is no session cookie in play on these requests.
//
// register and resend-verification email an address the caller typed, so they
// also carry the mail caps, AFTER validation: a rejected form costs nothing,
// and every request that gets past it counts, even one whose client hangs up
// (see middlewares/rateLimit.js). Per-recipient first: requests it turns away
// then never reach the per-caller count, so hammering one address does not use
// up the budget everyone behind the same public IP shares.
router.post('/register', registerValidation, mailRecipientLimiter, mailSendLimiter, authController.register);
router.post('/verify-email', verifyEmailValidation, authController.verifyEmail);
router.post(
  '/resend-verification',
  resendVerificationValidation,
  mailRecipientLimiter,
  mailSendLimiter,
  authController.resendVerification,
);

// "Forgot password" (25.11.2026). Public for the same reason as the routes
// above: the caller cannot log in, that is the point. forgot-password emails
// an address the caller typed, so it carries the same mail caps, in the same
// order. reset-password needs the emailed token and is throttled by
// registerLimiter in app.js.
router.post(
  '/forgot-password',
  forgotPasswordValidation,
  mailRecipientLimiter,
  mailSendLimiter,
  authController.forgotPassword,
);
router.post('/reset-password', resetPasswordValidation, authController.resetPassword);

// Who am I? Authenticated by definition — this is the only way a client holding
// an httpOnly session cookie can discover the identity inside it (see the
// handler for why that matters). Not CSRF-exempt is fine: it is a GET.
router.get('/me', auth, authController.me);

// Clears the auth + CSRF cookies. Requires a valid session so a stray request
// can't be used to probe; exempt from CSRF (it only clears state).
router.post('/logout', auth, authController.logout);

export default router;
