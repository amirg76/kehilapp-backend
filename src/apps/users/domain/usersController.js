import { getUserFromDb , getUsersFromDb } from '../../../apps/users/dataAccess/userRepository.js';
import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';


export const getUsers = async (req, res, next) => {
  const users = await getUsersFromDb();
  if (!users) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  res.status(200).json({
    status: 'success',
    data: users,
  });
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

  res.json({
    status: 'success',
    data: user,
  });
};
