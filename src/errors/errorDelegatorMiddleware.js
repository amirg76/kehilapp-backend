import AppError from './AppError.js';
import multer from 'multer';
// error handlers utils
import applyMulterErrorHandler from './utils/multerErrorHandling.js';
import handleErrors from './utils/errorHandlers.js';
import errorManagement from './utils/errorManagement.js';

// multer 2 reports a client that hung up mid-upload as a plain Error with one
// of these messages. That is the client leaving, not a bug in this server, so
// it must not be logged as an unhandled 500.
const CLIENT_GONE = new Set(['Request aborted', 'Request closed']);

const errorDelegatorMiddleware = (error, req, res, next) => {
  if (error instanceof AppError) {
    next(error);
  } else if (error instanceof multer.MulterError) {
    applyMulterErrorHandler(error, next);
  } else if (error instanceof Error && CLIENT_GONE.has(error.message)) {
    next(new AppError(error.message, errorManagement.commonErrors.badRequest.code, true));
  } else if (error instanceof Error) {
    handleErrors(error, next);
  } else {
    // Handle other unknown errors here
    next(new AppError('Unknown error', errorManagement.commonErrors.internalServerError.code, false));
  }
};

export default errorDelegatorMiddleware;
