import { getUserByEmailFromDb, getUserFromDb , getUsersFromDb } from '../../../apps/users/dataAccess/userRepository.js';
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

  res.status(200).json(user);
};

export const getUserByEmail = async (req, res, next) => {
  const { email, password } = req.body;
  const user = await getUserByEmailFromDb(email);

  if (!user) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  res.status(200).json(user);
};