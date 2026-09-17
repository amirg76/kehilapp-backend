import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';

import cookieParser from 'cookie-parser';
import globalErrorHandler from './errors/globalErrorHandler.js';
import errorDelegatorMiddleware from './errors/errorDelegatorMiddleware.js';
import AppError from './errors/AppError.js';
import corsMiddleware from './middlewares/cors.js';
import csrfProtection from './middlewares/csrf.js';
import logger, { forLog } from './services/logger.js';
import { apiLimiter, loginLimiter, registerLimiter } from './middlewares/rateLimit.js';

//import routes
import messagesRoutes from './apps/messages/entryPoints/messageRoutes.js';
import categoriesRoutes from './apps/categories/entryPoints/categoryRoutes.js';
import usersRoutes from './apps/users/entryPoints/userRoutes.js';
import authRoutes from './apps/auth/entryPoints/authRoutes.js';
import healthRoutes from './apps/health/healthRoutes.js';

const app = express();

// Behind Cloudflare / a load balancer the client IP arrives in X-Forwarded-For.
// Without this the rate limiter sees one proxy IP for everyone and throttles all
// users together. `1` trusts exactly one hop — never `true`, which would let a
// caller spoof the header and dodge the limit entirely.
app.set('trust proxy', 1);

// Security headers first, so they are set even on responses that fail later.
app.use(helmet());

app.use(cookieParser());
app.use(corsMiddleware);
app.use(express.json({ limit: '100kb' }));

// Strips keys containing `$` or `.` from body, query and params, so user input
// cannot smuggle Mongo operators into a filter (e.g. {"email": {"$ne": null}}).
app.use(mongoSanitize());

// Health probes sit BEFORE the API limiter: a monitor polling every few seconds
// must never be rate-limited into reporting a false outage.
app.use('/', healthRoutes);

app.use(apiLimiter);

// CSRF double-submit check on mutating requests (reads and login/logout exempt).
app.use(csrfProtection);

// Request log. Silent under test so suite output stays readable.
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    logger.info(`${req.method} ${forLog(req.path)}`);
    next();
  });
}

// Routes
app.use('/api/messages', messagesRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/users', usersRoutes);
// The tighter limiter is mounted ahead of the auth router: this is the only
// unauthenticated route in the API, so it is the only brute-force surface.
// Scope each limiter to what it actually protects. Mounting the tight login
// limiter across all of /api/auth also throttled registration, which surfaced to
// users as a generic "registration failed".
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/verify-email', registerLimiter);
app.use('/api/auth/resend-verification', registerLimiter);
app.use('/api/auth', authRoutes);

app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404, true));
});

// Error handling
app.use(errorDelegatorMiddleware);
app.use(globalErrorHandler);

export default app;
