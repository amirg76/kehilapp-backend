import AppError from '../../errors/AppError.js';
import User from '../../apps/users/dataAccess/userModel.js';
import { adminLoginSchema } from '../schemas/adminSchema.js';
import errorManagement from '../../errors/utils/errorManagement.js';

export const validateAdminLogin = async (req, res, next) => {
  try {
    await adminLoginSchema.validateAsync(req.body, { abortEarly: false });

    const user = await User.findOne({ email: req.body.email });

    if (!user || user.role !== 'admin') {
      throw new AppError(
        errorManagement.commonErrors.authorizationError.message,
        errorManagement.commonErrors.authorizationError.code,
        null,
        errorManagement.errorSeverity.MEDIUM,
        errorManagement.errorSources.AUTHENTICATION_SERVICE,
      );
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
