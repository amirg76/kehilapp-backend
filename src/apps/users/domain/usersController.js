import mongoose from 'mongoose';
import {
  countAdminsInDb,
  getUserFromDb,
  getUsersFromDb,
  setUserApprovalInDb,
  setUserRoleInDb,
} from '../dataAccess/userRepository.js';
import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';

/**
 * True when two ids name the same account.
 *
 * A plain string compare is NOT enough. MongoDB parses an ObjectId from hex
 * case-insensitively, so `/api/users/<SAME-ID-UPPERCASED>/revoke` reached the
 * same document while `String(a) === String(b)` said "different user" — which is
 * how the self-revoke guard below was walked straight past.
 *
 * An id that is not a valid ObjectId at all is compared as text and simply does
 * not match, rather than throwing a BSONError into a 500.
 */
const isSameUser = (a, b) => {
  if (a === undefined || a === null || b === undefined || b === null) return false;

  const left = String(a);
  const right = String(b);
  if (left === right) return true;

  if (!mongoose.Types.ObjectId.isValid(left) || !mongoose.Types.ObjectId.isValid(right)) return false;

  return new mongoose.Types.ObjectId(left).equals(new mongoose.Types.ObjectId(right));
};

/**
 * The shape an approval response hands back — fields named explicitly, the same
 * narrowing this controller already does on a read. Naming the fields (rather
 * than spreading the document) is what keeps passwordHash and the verification
 * token fields out of the response even if a future change unhides them.
 */
const toSafeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  approved: user.approved === true,
  approvedAt: user.approvedAt,
  approvedBy: user.approvedBy,
  // The other half of the trail. Exactly one of the two pairs is ever set (the
  // repository clears the other), so the response says which decision was last.
  revokedAt: user.revokedAt,
  revokedBy: user.revokedBy,
});

const notFoundError = () =>
  new AppError(
    errorManagement.commonErrors.resourceNotFound.message,
    errorManagement.commonErrors.resourceNotFound.code,
    true,
  );

export const getUsers = async (req, res, next) => {
  const users = await getUsersFromDb();
  if (!users || !users.length) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  res.status(200).json(users);
};

export const getUserById = async (req, res, next) => {
  const { userId } = req.params;
  const user = await getUserFromDb(userId);

  if (!user) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  // Authorization on a read: a member may see the full record only for
  // themselves; an admin may see anyone's. For everyone else this endpoint
  // used to hand back name + email + role of any user by id — email harvesting
  // by any signed-in member. Others now get a minimal public view (name only).
  const isSelf = isSameUser(req.userId, userId);
  const isAdmin = req.role === 'admin';

  if (isSelf || isAdmin) {
    return res.status(200).json(user);
  }

  return res.status(200).json({ _id: user._id, name: user.name });
};

/**
 * Admits an account to the community.
 *
 * Email verification proves the address; this is the human decision that the
 * holder of that address belongs here. Because approval is read from the user
 * document on every request, the effect is immediate — the approved member's
 * existing session sees members-only content on its very next request, with no
 * re-login.
 */
export const approveUser = async (req, res, next) => {
  const { userId } = req.params;

  const user = await setUserApprovalInDb(userId, { approved: true, actorId: String(req.userId) });
  if (!user) {
    return next(notFoundError());
  }

  return res.status(200).json(toSafeUser(user));
};

/** Withdraws approval, returning the account to public-only content. */
export const revokeUser = async (req, res, next) => {
  const { userId } = req.params;

  // A board with no approved admin is a locked board: refuse the one move an
  // admin cannot undo from inside the app. Compared as ObjectIds, not strings —
  // see isSameUser above for the casing hole that compare used to leave open.
  if (isSameUser(req.userId, userId)) {
    return next(
      new AppError('An admin cannot revoke their own approval.', errorManagement.commonErrors.badRequest.code, true),
    );
  }

  // Revoking an admin is a 200 that takes nothing away: every authorization check
  // in the app bypasses on role === 'admin' (requireRole never looks at
  // `approved`, and both the content-tier check and requireApproved let an admin
  // through by design). The account would keep reading, deleting and approving —
  // and could approve itself back — while the dashboard displayed it as pending.
  // Refusing is the honest answer: containing an admin means changing their role,
  // which this API does not yet offer.
  const target = await getUserFromDb(userId);
  if (!target) {
    return next(notFoundError());
  }

  if (target.role === 'admin') {
    return next(
      new AppError(
        'Cannot revoke an admin\'s approval — it would take nothing away. To remove an admin\'s powers, demote them with PATCH /api/users/:userId/role {"role":"member"}, then revoke if you still want to.',
        errorManagement.commonErrors.badRequest.code,
        true,
      ),
    );
  }

  // The acting admin is recorded here too. A revocation with no "who" is the
  // half of the audit trail that gets asked about after the fact.
  const user = await setUserApprovalInDb(userId, { approved: false, actorId: String(req.userId) });
  if (!user) {
    return next(notFoundError());
  }

  return res.status(200).json(toSafeUser(user));
};

/**
 * Changes an account's role — the missing capability that made revokeUser refuse.
 *
 * Every authorization check in this app keys on `role`, and until now there was
 * no way through the API to take a role away. A compromised admin could only be
 * dealt with by hand in the database. This is the tool; revoking approval never
 * was.
 *
 * Because `req.role` is read from the user document on every request rather than
 * from a JWT claim, a demotion applies to the target's EXISTING token on their
 * very next request. No waiting out a 12-hour token.
 *
 * Two guards, and each exists because of a way this can be made irreversible:
 *
 *   1. The LAST admin may not be demoted. Zero admins means nobody can approve a
 *      member, promote an admin, or reach this route ever again — there is no way
 *      back from inside the app.
 *   2. An admin may not change their OWN role. Compared with isSameUser, not
 *      `===`: MongoDB parses an ObjectId from hex case-insensitively, so an
 *      upper-cased id reaches the same document while a string compare says
 *      "different user" — exactly the bypass the self-revoke guard was walked
 *      past once already.
 *
 * ORDER MATTERS, and not for style. requireRole means the caller is an admin, so
 * whenever the target is a DIFFERENT admin there are at least two admins and the
 * last-admin case cannot arise. The only way to reach it is an admin demoting
 * THEMSELVES while they are the only one — where guard 2 also applies. Checking
 * the count first is what makes guard 1 reachable at all, and it is the answer
 * that helps: "ask another admin" is useless advice when there is no other admin.
 */
export const changeUserRole = async (req, res, next) => {
  const { userId } = req.params;
  const { role } = req.body;

  const target = await getUserFromDb(userId);
  if (!target) {
    return next(notFoundError());
  }

  // Only a demotion can empty the admin set, and only when this account is
  // currently one of them. Counting on every call would cost a query to refuse
  // nothing.
  if (role !== 'admin' && target.role === 'admin') {
    const admins = await countAdminsInDb();
    if (admins <= 1) {
      return next(
        new AppError(
          'Cannot demote the last remaining admin — the board would be left with nobody able to administer it. Promote another admin first.',
          errorManagement.commonErrors.badRequest.code,
          true,
        ),
      );
    }
  }

  if (isSameUser(req.userId, userId)) {
    return next(
      new AppError(
        'An admin cannot change their own role. Ask another admin to do it.',
        errorManagement.commonErrors.badRequest.code,
        true,
      ),
    );
  }

  const user = await setUserRoleInDb(userId, role);
  if (!user) {
    return next(notFoundError());
  }

  return res.status(200).json(toSafeUser(user));
};
