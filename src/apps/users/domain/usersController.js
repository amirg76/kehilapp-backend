import { getUserFromDb, getUsersFromDb } from '../dataAccess/userRepository.js';
import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';

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
  const isSelf = String(req.userId) === String(userId);
  const isAdmin = req.role === 'admin';

  if (isSelf || isAdmin) {
    return res.status(200).json(user);
  }

  return res.status(200).json({ _id: user._id, name: user.name });
};
