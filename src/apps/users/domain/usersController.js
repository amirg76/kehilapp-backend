import {
  getUserByEmailFromDb,
  getUserFromDb,
  getUsersFromDb,
  createUser,
} from '../../../apps/users/dataAccess/userRepository.js';
import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import { createErrorResponse } from '../../../errors/utils/mongoDbErrorHandler/createErrorResponse.js';

export const createNewUser = async (newUser) => {
  const user = await createUser(newUser);

  if (!user) {
    throw new AppError(
      errorManagement.commonErrors.resourceNotFound.message,
      errorManagement.commonErrors.resourceNotFound.code,
      true,
    );
  }

  return user;
};
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

// A function to get a user by email from the database
export const findUserByEmail = async (email) => {
  try {
    const user = await getUserByEmailFromDb(email);

    return user;
  } catch (error) {
    throw new Error('Error fetching user from the database');
  }
};

export const getUserByEmail = async (email, next) => {
  try {
    const user = await getUserByEmailFromDb(email);

    return user;
  } catch (error) {
    next(error);
  }
};
