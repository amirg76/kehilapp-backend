import AppError from '../errors/AppError.js';
import errorManagement from '../errors/utils/errorManagement.js';

/**
 * Authorization guard. Runs after `auth`, which puts the caller's role on the
 * request.
 *
 * Authentication answers "who are you". This answers "what may you do" — a
 * distinction the codebase previously did not make at all: once authentication
 * was restored, every signed-in user could still wipe the message collection.
 *
 * 403, not 401: the caller proved who they are, they simply are not allowed.
 * Returning 401 here would tell them to log in again, which never helps.
 *
 *   router.delete('/', auth, requireRole('admin'), deleteAllMessages);
 */
const requireRole = (...allowedRoles) => {
  if (allowedRoles.length === 0) {
    // Fail at startup rather than silently allowing everyone through.
    throw new Error('requireRole needs at least one role');
  }

  const guard = (req, res, next) => {
    // Defensive: reaching here without `auth` in front means the route is
    // misconfigured. Deny rather than read an undefined role.
    if (!req.role) {
      return next(
        new AppError(
          errorManagement.commonErrors.authenticationError.message,
          errorManagement.commonErrors.authenticationError.code,
          true,
        ),
      );
    }

    if (!allowedRoles.includes(req.role)) {
      return next(
        new AppError(
          errorManagement.commonErrors.authorizationError.message,
          errorManagement.commonErrors.authorizationError.code,
          true,
        ),
      );
    }

    return next();
  };

  // Tagged so the authorization gate in src/test/routeAuthGuard.test.js can find
  // this middleware in an Express handler stack. The returned closure is
  // anonymous, so without a marker the test would have to match on source text.
  guard.allowedRoles = allowedRoles;

  return guard;
};

export default requireRole;
