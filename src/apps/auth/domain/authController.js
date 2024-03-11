import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import { getUserByEmail } from '../../users/domain/usersController.js';


export const login = async (req, res, next) => {

  const user = await getUserByEmail(req);
  if (!user) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  res.status(200).json(user);
};

