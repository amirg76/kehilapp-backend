import AppError from '../../../errors/AppError.js';
import { getUserByEmail, createNewUser, findUserByEmail } from '../../users/domain/usersController.js';
import bcrypt from 'bcryptjs';

import { generateToken } from '../dataAccess/authRepository.js';
import AppSuccess from '../../../utils/responses/successResponses/AppSuccess.js';
import { successHandler } from '../../../utils/responses/successResponses/globalSuccessHandler.js';
import { successResponses } from '../../../utils/responses/successResponses/responseManagement.js';
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
      return next(new AppError('Invalid User', 403));
    }

    if (user) {
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return next(new AppError('סיסמא לא נכונה, נסה שוב', 401));
      }

      const token = await generateToken(user);

      // Get the raw document fields from _doc and format the user data
      const { password: _, ...userWithoutPassword } = user._doc;

      // Set the user email for logging
      res.locals.userEmail = email;

      // Send standardized success response
      const response = new AppSuccess(
        {
          token,
          user: userWithoutPassword,
        },
        successResponses.ok.message,
        successResponses.ok.code,
      );
      return successHandler(res, response);
    }
  } catch (error) {
    console.error(error);

    next(error);
  }
};
