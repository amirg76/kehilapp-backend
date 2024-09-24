import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import { getUserByEmail, createNewUser, findUserByEmail } from '../../users/domain/usersController.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import logger from '../../../services/logger.js';
import { generateToken } from '../dataAccess/authRepository.js';
export const registerUser = async (req, res, next) => {
  try {
    const { email, password, role } = req.body;
    console.log(email, password, role);

    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      return next(new AppError('User already exists', 409));
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await createNewUser({ email, password: hashedPassword, role });

    // const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const token = await generateToken(user);

    console.log('token', token);

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

      const token = await generateToken(user);

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
