import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

const userSchema = new Schema(
  {
    // Scaffolding field kept optional so existing documents still validate.
    exampleId: { type: String },

    name: { required: true, type: String },

    email: {
      required: true,
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // `select: false` keeps the hash out of every ordinary query. Login has to
    // ask for it explicitly (see getUserByEmailForLoginFromDb), which makes any
    // future leak a deliberate act rather than an accident.
    passwordHash: { required: true, type: String, select: false },

    role: { type: String, enum: ['member', 'admin'], default: 'member' },

    // Self-registered accounts start unverified and cannot log in until they
    // confirm ownership of the address. Default false so a new account is never
    // trusted by accident; the seed and the test fixtures set it true explicitly.
    emailVerified: { type: Boolean, default: false },

    // We store only the SHA-256 of the verification token, never the token
    // itself — same reasoning as the password hash. A read of the users
    // collection therefore does not hand an attacker a working verification link.
    // `select: false` keeps it out of ordinary queries; verification asks for it
    // explicitly.
    emailVerificationTokenHash: { type: String, select: false },

    // When the current verification token stops being accepted. A leaked or
    // forgotten link should not stay usable forever.
    emailVerificationExpires: { type: Date, select: false },
  },
  { timestamps: true },
);

applyErrorHandlingMiddleware(userSchema);

export default mongoose.model('User', userSchema);
