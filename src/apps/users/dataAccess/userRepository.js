import UserModel from './userModel.js';

export const getUsersFromDb = async () => {
  return UserModel.find();
};

export const getUserFromDb = async (id) => {
  return UserModel.findById(id);
};

/**
 * Login-only lookup: the single place that pulls passwordHash back out.
 * Everything else gets a user object without it.
 */
export const getUserByEmailForLoginFromDb = async (email) => {
  return UserModel.findOne({ email }).select('+passwordHash');
};

/** Plain lookup by email (no secret fields). Used by resend-verification. */
export const getUserByEmailFromDb = async (email) => {
  return UserModel.findOne({ email }).select('+emailVerificationTokenHash +emailVerificationExpires');
};

/**
 * Creates a self-registered account. The caller has already hashed the password
 * and the verification token; this layer never sees a plaintext secret.
 */
export const createUserInDb = async ({
  name,
  email,
  passwordHash,
  emailVerificationTokenHash,
  emailVerificationExpires,
}) => {
  return UserModel.create({
    name,
    email,
    passwordHash,
    role: 'member',
    emailVerified: false,
    emailVerificationTokenHash,
    emailVerificationExpires,
  });
};

/**
 * Flips the admin-approval flag on an account.
 *
 * Both directions are a human decision and both leave a trail. Approving records
 * who decided and when. Revoking $unsets those same fields — a stale approvedBy
 * on an unapproved account reads like it is still approved — but writes
 * revokedAt/revokedBy in their place, so a withdrawal is no longer
 * indistinguishable from an account that was never admitted at all.
 *
 * Each direction clears the other's fields, so the document can never carry both
 * an approval trail and a revocation trail and leave the reader to guess which
 * one happened last.
 *
 * Returns the updated document, or null when no account has that id.
 */
export const setUserApprovalInDb = async (userId, { approved, actorId }) => {
  const now = new Date();
  const update = approved
    ? {
        $set: { approved: true, approvedAt: now, approvedBy: actorId },
        $unset: { revokedAt: '', revokedBy: '' },
      }
    : {
        $set: { approved: false, revokedAt: now, revokedBy: actorId },
        $unset: { approvedAt: '', approvedBy: '' },
      };

  return UserModel.findByIdAndUpdate(userId, update, { new: true });
};

/**
 * Sets an account's role. Returns the updated document, or null for an unknown
 * id. `runValidators` so the schema's role enum is enforced here too and not only
 * by the request validation — a repository is not the place to trust the caller.
 */
export const setUserRoleInDb = async (userId, role) => {
  return UserModel.findByIdAndUpdate(userId, { $set: { role } }, { new: true, runValidators: true });
};

/**
 * How many admins exist right now. Used by the last-admin guard: a board with no
 * admin is a board nobody can ever administer again, and no API call can undo it.
 */
export const countAdminsInDb = async () => {
  return UserModel.countDocuments({ role: 'admin' });
};

/**
 * Finds the account holding this verification token hash, still within its
 * validity window. Returns null when no unexpired match exists — a wrong,
 * already-used, or expired token all look the same to the caller on purpose.
 */
export const getUserByVerificationTokenHashFromDb = async (tokenHash) => {
  return UserModel.findOne({
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpires: { $gt: new Date() },
  }).select('+emailVerificationTokenHash +emailVerificationExpires');
};
