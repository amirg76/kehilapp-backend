import express from 'express';
import {
  loginValidation,
  registerValidation,
  verifyEmailValidation,
  resendVerificationValidation,
} from './authValidation.js';
import * as authController from '../domain/authController.js';
import auth from '../../../middlewares/auth.js';

const router = express.Router();

// Public login. Listed explicitly in PUBLIC_ROUTES in
// src/test/routeAuthGuard.test.js; every other route must carry the auth
// middleware or the test suite fails.
router.post('/login', loginValidation, authController.login);

// Self-registration + email verification. All three are unauthenticated by
// necessity — the caller has no account yet, or is trying to activate one — and
// are listed in PUBLIC_ROUTES with a reason. They are also CSRF-exempt in
// middlewares/csrf.js: there is no session cookie in play on these requests.
router.post('/register', registerValidation, authController.register);
router.post('/verify-email', verifyEmailValidation, authController.verifyEmail);
router.post('/resend-verification', resendVerificationValidation, authController.resendVerification);

// Who am I? Authenticated by definition — this is the only way a client holding
// an httpOnly session cookie can discover the identity inside it (see the
// handler for why that matters). Not CSRF-exempt is fine: it is a GET.
router.get('/me', auth, authController.me);

// Clears the auth + CSRF cookies. Requires a valid session so a stray request
// can't be used to probe; exempt from CSRF (it only clears state).
router.post('/logout', auth, authController.logout);

export default router;
