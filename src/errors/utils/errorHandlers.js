import { isCelebrateError } from 'celebrate';
import AppError from '../AppError.js';
import errorManagement from './errorManagement.js';

/**
 * Normalises an unknown Error into exactly one AppError and forwards it once.
 *
 * Every branch now returns. Previously they fell through: a validation error was
 * forwarded as operational AND THEN again as non-operational, and the second one
 * used to reach process.exit. The CastError branch also omitted its
 * isOperational flag, so a bad :id was treated as a crash-worthy bug.
 */
const handleErrors = (error, next) => {
  // A malformed request body/query/params — expected, operational, 400.
  if (isCelebrateError(error)) {
    return next(
      new AppError(
        errorManagement.commonErrors.validationError.message,
        errorManagement.commonErrors.validationError.code,
        true,
      ),
    );
  }

  // A malformed ObjectId in the URL — expected, operational, 400.
  if (error.name === 'CastError') {
    return next(
      new AppError(errorManagement.commonErrors.castError.message, errorManagement.commonErrors.castError.code, true),
    );
  }

  // A duplicate key from a unique index — expected, operational, 409.
  if (error.code === 11000) {
    return next(
      new AppError(
        errorManagement.commonErrors.duplicateResource.message,
        errorManagement.commonErrors.duplicateResource.code,
        true,
      ),
    );
  }

  // Anything else is a genuine bug: non-operational, logged in full upstream,
  // generic message to the client. Never crashes the process now.
  return next(new AppError(error.message, errorManagement.commonErrors.internalServerError.code, false));
};

export default handleErrors;
