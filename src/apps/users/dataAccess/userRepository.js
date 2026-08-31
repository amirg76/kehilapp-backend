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
