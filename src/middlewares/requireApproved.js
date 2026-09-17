import AppError from '../errors/AppError.js';
import errorManagement from '../errors/utils/errorManagement.js';

/**
 * Membership guard. Runs after `auth`, which puts the caller's approval state on
 * the request.
 *
 * Verifying an email proves the caller owns that address. It does not prove they
 * belong to the kibbutz. The product rule is therefore: an unapproved account may
 * READ public content and nothing more — writing is membership. Without this
 * guard a stranger who registered with an address they control could publish to
 * the community board and push files into the bucket, with no admin ever
 * admitting them.
 *
 * The admin bypass is the same explicit one the content-tier check uses (see
 * canSeeMembersContent in messagesController.js), and for the same reason: an
 * admin created by the seed — or before this field existed — must never be
 * locked out of their own board.
 *
 * `req.approved` and `req.role` both come from the user document on every request
 * (see auth.js), not from a JWT claim, so a revocation bites immediately instead
 * of waiting out the token.
 *
 * 403, not 401: the caller proved who they are, they are simply not admitted yet.
 *
 *   router.post('/', auth, requireApproved, upload.single('file'), createMessage);
 */
const requireApproved = (req, res, next) => {
  // Defensive: reaching here without `auth` in front means the route is
  // misconfigured. Deny rather than read an undefined identity.
  if (!req.userId) {
    return next(
      new AppError(
        errorManagement.commonErrors.authenticationError.message,
        errorManagement.commonErrors.authenticationError.code,
        true,
      ),
    );
  }

  if (req.approved === true || req.role === 'admin') {
    return next();
  }

  return next(
    new AppError(
      errorManagement.commonErrors.authorizationError.message,
      errorManagement.commonErrors.authorizationError.code,
      true,
    ),
  );
};

// Tagged so the authorization gate in src/test/routeAuthGuard.test.js can find
// this middleware in an Express handler stack by identity-independent means,
// exactly as requireRole tags the closure it returns.
requireApproved.requiresApproval = true;

export default requireApproved;
