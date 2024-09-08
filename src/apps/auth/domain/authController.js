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
    console.log(existingUser);

    if (existingUser) {
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
  try {
    const { email, password } = req.body;

    const user = await getUserByEmail(email, next);
    if (!user) {
      logger.info('Invalid user attempted login', { email });

      return res.status(200).json({
        success: false,
        error: {
          status: 404,
          message: 'Invalid User',
        },
      });
    }
    if (user) {
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        logger.info('Invalid password attempt', { email });

        return res.status(200).json({
          success: false,
          error: {
            status: 401,
            message: 'Invalid Password',
          },
        });
      }
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

      res.status(200).json({ token });
    }
  } catch (error) {
    console.error(error);

    next(error);
  }
};
