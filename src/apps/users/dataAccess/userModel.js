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

    // "Forgot password" (25.11.2026). Same shape as the verification token: only
    // the SHA-256 of the emailed token is stored, it expires, and it is out of
    // every ordinary query.
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    // Bumped by every password reset. Login puts it in the session token, and
    // the auth middleware refuses a token whose number is not the current one,
    // so a reset also logs out whoever else was signed in. A counter, not a
    // timestamp: a token's issue time is in whole seconds, so a time compare
    // either keeps a session opened in the same second as the reset or refuses
    // a login made right after it. Not secret: the ordinary lookup reads it.
    // Default 0, which is also what a token signed before this field reads as.
    passwordVersion: { type: Number, default: 0 },
    // When the password last changed through a reset (for the record).
    passwordChangedAt: { type: Date },

    // Verified is not the same as trusted. Verifying an email proves the caller
    // controls that address — nothing more. Belonging to the community is a
    // human admission decision, so an admin approves an account explicitly
    // before it sees members-only content. Default false: a document written
    // before this field existed hydrates as unapproved, which is the safe side.
    approved: { type: Boolean, default: false },
    approvedAt: { type: Date },
    approvedBy: { type: String },

    // Withdrawing an admission is a human decision too, and the one that gets
    // asked about afterwards ("who removed them, and when?"). Revoking used to
    // only $unset the approval fields, which left the account looking exactly
    // like one that had never been admitted at all. These two keep the trail.
    // Cleared again on a re-approval so the two states never both read as true.
    revokedAt: { type: Date },
    revokedBy: { type: String },
  },
  { timestamps: true },
);

applyErrorHandlingMiddleware(userSchema);

export default mongoose.model('User', userSchema);
