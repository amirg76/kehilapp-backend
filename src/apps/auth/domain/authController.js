import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import { getUserByEmail } from '../../users/domain/usersController.js';


export const login = async (req, res, next) => {
  const { email, password } = req.body;

  //TODO: replace with real auth using JWT
  // const user = await getUserByEmail(req);
  // const match = password === user?.password

  if (email !== "user@example.com" || password !== "user@example.com") {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  res.status(200).json(user);
};

