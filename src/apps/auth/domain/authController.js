import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import { getUsers } from '../../users/domain/usersController.js';


export const login = async (req, res, next) => {
  const users = await getUsers();
  if (!users) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  res.status(200).json(users);
};

