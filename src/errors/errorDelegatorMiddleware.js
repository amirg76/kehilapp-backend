import AppError from './AppError.js';
import multer from 'multer';
// error handlers utils
import applyMulterErrorHandler from './utils/multerErrorHandling.js';
import handleErrors from './utils/errorHandlers.js';
import errorManagement from './utils/errorManagement.js';

const errorDelegatorMiddleware = (error, req, res, next) => {
  if (error instanceof AppError) {
    console.log('errorDelegatorMiddleware : ', error.message);
    if (res.headersSent) {
      return;
    }
    next(error);
  } else if (error instanceof multer.MulterError) {
    applyMulterErrorHandler(error, next);
  } else if (error instanceof Error) {
    handleErrors(error, next);
  } else {
    // Handle other unknown errors here
    next(new AppError('Unknown error', errorManagement.commonErrors.internalServerError.code, false));
  }
};

export default errorDelegatorMiddleware;
