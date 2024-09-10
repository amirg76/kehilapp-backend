import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import { getUserByEmail, createNewUser, findUserByEmail } from '../../users/domain/usersController.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import logger from '../../../services/logger.js';
export const registerUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      return next(new AppError('User already exists', 409));
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await createNewUser({ email, password: hashedPassword });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    console.log(token);

    res.status(201).json({
      success: true,
      data: { token },
    });
  } catch (error) {
    next(error);
  }
};
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await getUserByEmail(email, next);

    if (!user) {
      return next(new AppError('Invalid User', 404));
    }

    if (user) {
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return next(new AppError('Invalid Password', 401));
      }
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

      res.status(201).json({
        success: true,
        data: { token },
      });
    }
  } catch (error) {
    console.error(error);

    next(error);
  }
};
