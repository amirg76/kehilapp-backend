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
      // Every other multer code is a malformed upload from the client: a field
      // name that is too long, missing or invalid, too many parts or fields.
      // multer 2 added several of these codes. This branch used to call next()
      // with no error, which skipped the error handlers and answered 404.
      next(
        new AppError(
          errorManagement.commonErrors.badRequest.message,
          errorManagement.commonErrors.badRequest.code,
          true,
        ),
      );
    }
  } else {
    next();
  }
}
