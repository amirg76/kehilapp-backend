import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import { getUserByEmail } from '../../users/domain/usersController.js';


export const login = async (req, res, next) => {
  const { email, password } = req.body;

  console.log(email, password);
  //TODO: replace with real auth using JWT
  // const user = await getUserByEmail(req);
  // const match = password === user?.password
  console.log('login back');
  if (email !== "user@example.com" || password !== "user@example.com") {
    return next(
      new AppError(
        errorManagement.commonErrors.authenticationError.message,
        errorManagement.commonErrors.authenticationError.code,
        true
      ),
    );
  } else {
    const user = { id: 1, name: "ישראל ישראלי" };
    res.status(200).json(user);
  }

};

