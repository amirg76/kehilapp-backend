import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import { getUserByEmail, createNewUser, findUserByEmail } from '../../users/domain/usersController.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export const registerUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const existingUser = await findUserByEmail(email);
    console.log(existingUser);

    if (existingUser) {
      // return next(new Error('User already exists'));
      return res.status(201).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await createNewUser({ email, password: hashedPassword });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    console.log(token);

    res.status(201).json({ token });
  } catch (error) {
    next(error);
  }
};
export const login = async (req, res, next) => {
  const { email, password } = req.body;

  console.log(email, password);
  //TODO: replace with real auth using JWT
  const user = await getUserByEmail(req);
  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    return next(new Error('Invalid password'));
  }

  const match = password === user?.password;
  console.log('login back');
  // if (email !== 'user@example.com' || password !== 'user@example.com') {
  if (!match) {
    return next(
      new AppError(
        errorManagement.commonErrors.authenticationError.message,
        errorManagement.commonErrors.authenticationError.code,
        true,
      ),
    );
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

  res.status(200).json({ token });
  // else {
  //   const user = { id: 1, name: 'ישראל ישראלי' };
  //   res.status(200).json(user);
  // }
};
