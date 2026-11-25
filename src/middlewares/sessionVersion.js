/**
 * Is this session token still good for this account's current password?
 *
 * A password reset bumps user.passwordVersion; login signs the version into the
 * token as `pwv` (authController.login). A token from before the field existed
 * has no `pwv` and reads as 0, the default.
 *
 * One function for BOTH session checks (25.11.2026). It first lived only in
 * auth.js, and the security review showed optionalAuth.js still honoured a
 * token signed before a reset: GET /api/messages kept showing members-only
 * posts to a stolen session the reset was supposed to end.
 */
export const isCurrentSession = (decoded, user) => (decoded?.pwv ?? 0) === (user?.passwordVersion ?? 0);

export default isCurrentSession;
