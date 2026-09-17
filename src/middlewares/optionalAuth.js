import pkg from 'jsonwebtoken';
import AppError from '../errors/AppError.js';
import errorManagement from '../errors/utils/errorManagement.js';
import { getUserFromDb } from '../apps/users/dataAccess/userRepository.js';
import { getJwtSecret } from '../config/env.js';
import { AUTH_COOKIE } from '../config/cookies.js';

const { verify } = pkg;

/**
 * Best-effort authentication for routes that are public but behave differently
 * for a signed-in caller.
 *
 * Unlike the strict `auth` middleware, an ABSENT or INVALID credential is not an
 * error here: the request continues as anonymous, with req.userId / req.role left
 * undefined. Only a genuinely valid token for a still-existing user populates
 * them. This is what lets GET /api/messages serve public-only content to the
 * public while unlocking members-only content for a real session — without ever
 * turning the endpoint into a 401.
 *
 * It deliberately does NOT reuse `auth`: `auth` calls next(error) on a missing or
 * bad token, and the whole point here is the opposite. Keeping them separate also
 * keeps the route-guard test honest — this middleware is named `optionalAuth`, so
 * it is never mistaken for the strict gate the test looks for.
 */
const verifyToken = async (token) =>
  new Promise((resolve) => {
    // Same algorithm pinning as the strict middleware — a token must not choose
    // its own verification scheme.
    verify(token, getJwtSecret(), { algorithms: ['HS256'] }, (err, decoded) => {
      if (err) return resolve(undefined);
      const usable = typeof decoded === 'object' && decoded !== null && 'id' in decoded && 'role' in decoded;
      return resolve(usable ? decoded : undefined);
    });
  });

const optionalAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.[AUTH_COOKIE];

    if (!token) {
      const authHeader = req.headers?.authorization;
      // No usable credential — carry on as anonymous.
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
      }
      const [prefix, headerToken, ...rest] = authHeader.split(' ');
      if (prefix !== 'Bearer' || !headerToken || rest.length > 0) {
        return next();
      }
      token = headerToken;
    }

    const decoded = await verifyToken(token);
    if (!decoded) return next(); // present but unusable → anonymous, not 401

    const { id: userId } = decoded;

    // The token can outlive the account it names; an orphaned token stays anonymous.
    const user = await getUserFromDb(userId);
    if (!user) return next();

    req.userId = userId;
    // Same reasoning as the strict middleware: role and approval are read from the
    // document rather than from JWT claims, so a demotion or a revocation applies
    // to the very next request instead of waiting out the token, and an approval
    // applies without the user logging in again.
    req.role = user.role;
    req.approved = user.approved === true;
    return next();
  } catch (err) {
    // A real fault (e.g. the database is down) is not something to swallow into
    // an anonymous request — surface it like any other server error.
    const message = err instanceof Error ? err.message : 'An unknown error occurred';
    return next(new AppError(message, errorManagement.commonErrors.internalServerError.code, false));
  }
};

export default optionalAuth;
