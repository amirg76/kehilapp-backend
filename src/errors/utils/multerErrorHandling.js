import errorManagement from './errorManagement.js';
import AppError from '../AppError.js';

export default function applyMulterErrorHandler(error, next) {
  if (error) {
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      next(
        new AppError(
          errorManagement.commonErrors.multerUnsupportedFile.message,
          errorManagement.commonErrors.multerUnsupportedFile.code,
          true,
        ),
      );
    } else if (error.code === 'LIMIT_FILE_SIZE') {
      next(
        new AppError(
          errorManagement.commonErrors.multerFileSizeLimit.message,
          errorManagement.commonErrors.multerFileSizeLimit.code,
          true,
        ),
      );
    } else if (error.code === 'LIMIT_FILE_COUNT') {
      next(
        new AppError(
          errorManagement.commonErrors.multerFileCount.message,
          errorManagement.commonErrors.multerFileCount.code,
          true,
        ),
      );
    } else {
      next();
    }
  } else {
    next();
  }
}
