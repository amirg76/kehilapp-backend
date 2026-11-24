import UserModel from './userModel.js';

export const getUsersFromDb = async () => {
  return UserModel.find();
};

export const getUserFromDb = async (id) => {
  return UserModel.findById(id);
};

/**
 * Login lookup. One of two places that pull passwordHash back out (the other
 * is getUserByVerificationTokenHashFromDb, for verify-email). Everything else
 * gets a user object without it.
 */
export const getUserByEmailForLoginFromDb = async (email) => {
  return UserModel.findOne({ email }).select('+passwordHash');
};

/** Plain lookup by email (no secret fields). Used by resend-verification. */
export const getUserByEmailFromDb = async (email) => {
  return UserModel.findOne({ email }).select('+emailVerificationTokenHash +emailVerificationExpires');
};

/**
 * The document a self-registration creates, NOT saved. register() answers a
 * taken address with one of these, so that answer carries the same fields and
 * defaults (role, emailVerified, approved, a fresh id) as a real new account
 * and cannot drift from it.
 */
export const buildRegistrationUser = ({
  name,
  email,
  passwordHash,
  emailVerificationTokenHash,
  emailVerificationExpires,
}) =>
  new UserModel({
    name,
    email,
    passwordHash,
    role: 'member',
    emailVerified: false,
    emailVerificationTokenHash,
    emailVerificationExpires,
  });

/**
 * Creates a self-registered account. The caller has already hashed the password
 * and the verification token; this layer never sees a plaintext secret.
 */
export const createUserInDb = async (fields) => {
  return buildRegistrationUser(fields).save();
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
 *
 * Pulls passwordHash too (the second place, after login): verify-email checks
 * the password chosen at registration, so that a link clicked by an address's
 * owner cannot activate an account a stranger opened with that address.
 */
export const getUserByVerificationTokenHashFromDb = async (tokenHash) => {
  return UserModel.findOne({
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpires: { $gt: new Date() },
  }).select('+emailVerificationTokenHash +emailVerificationExpires +passwordHash');
};

// The two writes below are single conditional updates, not load-then-save,
// on purpose (security review, 24.11.2026). verify-email loads the account,
// spends ~250 ms on bcrypt, then writes; a registration for the same address
// in that gap replaced the password, and a save() of the stale document then
// marked the account verified WITH THE NEW (stranger's) PASSWORD. The review
// reproduced it: the owner saw "verified", the stranger logged in. Each write
// now states the state it expects, and the database refuses it otherwise.

/**
 * Replaces a pending (never verified) registration. Returns the updated
 * account, or null if it was verified in the meantime: a verified account is
 * never touched by registration.
 */
export const replacePendingRegistrationInDb = async (
  userId,
  { name, passwordHash, emailVerificationTokenHash, emailVerificationExpires },
) =>
  UserModel.findOneAndUpdate(
    { _id: userId, emailVerified: false },
    { $set: { name, passwordHash, emailVerificationTokenHash, emailVerificationExpires } },
    { new: true },
  );

/**
 * Marks the account verified, only if it still holds this unexpired token
 * (a registration in between replaces the token, along with the password the
 * caller just checked). Returns true if it did.
 */
export const markEmailVerifiedInDb = async (userId, tokenHash) => {
  const result = await UserModel.updateOne(
    {
      _id: userId,
      emailVerified: false,
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpires: { $gt: new Date() },
    },
    { $set: { emailVerified: true }, $unset: { emailVerificationTokenHash: 1, emailVerificationExpires: 1 } },
  );
  return result.modifiedCount === 1;
};
