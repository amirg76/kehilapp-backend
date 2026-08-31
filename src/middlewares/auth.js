import pkg from 'jsonwebtoken';
import errorManagement from '../errors/utils/errorManagement.js';
import AppError from '../errors/AppError.js';
import { getUserFromDb } from '../apps/users/dataAccess/userRepository.js';
import { getJwtSecret } from '../config/env.js';
import { AUTH_COOKIE } from '../config/cookies.js';

const { verify } = pkg;

const throwUnauthorizedError = () =>
  new AppError(
    errorManagement.commonErrors.authenticationError.message,
    errorManagement.commonErrors.authenticationError.code,
    true,
  );

/**
 * Resolves the token payload, or undefined if the token is unusable.
 *
 * It deliberately does NOT touch `next`. The previous version called next() here
 * on a verify error AND resolved undefined, so the caller called next() a second
 * time — two responses for one request ("Cannot set headers after they are sent").
 * Error handling belongs to the caller, once.
 */
const verifyToken = async (token) =>
  new Promise((resolve) => {
    // Pin the algorithm: without this a token could, in principle, ask to be
    // verified with a different scheme than the one we sign with.
    verify(token, getJwtSecret(), { algorithms: ['HS256'] }, (err, decoded) => {
      if (err) return resolve(undefined);

      const usable = typeof decoded === 'object' && decoded !== null && 'id' in decoded && 'role' in decoded;

      return resolve(usable ? decoded : undefined);
    });
  });

const auth = async (req, res, next) => {
  try {
    // Prefer the httpOnly cookie; fall back to a Bearer header so existing
    // clients and the test suite keep working during the transition.
    let token = req.cookies?.[AUTH_COOKIE];

    if (!token) {
      const authHeader = req.headers?.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(throwUnauthorizedError());
      }
      const [prefix, headerToken, ...rest] = authHeader.split(' ');
      if (prefix !== 'Bearer' || !headerToken || rest.length > 0) {
        return next(throwUnauthorizedError());
      }
      token = headerToken;
    }

    const decoded = await verifyToken(token);
    if (!decoded) {
      return next(throwUnauthorizedError());
    }

    const { id: userId, role } = decoded;

    // The token can outlive the account it names, so confirm the user still exists.
    const user = await getUserFromDb(userId);
    if (!user) return next(throwUnauthorizedError());

    req.userId = userId;
    req.role = role;
    return next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    return next(new AppError(message, errorManagement.commonErrors.internalServerError.code, false));
  }
};

export default auth;
