// import AppError from './AppError.js';
// import multer from 'multer';
// // error handlers utils
// import applyMulterErrorHandler from './utils/multerErrorHandling.js';
// import handleErrors from './utils/errorHandlers.js';
// import errorManagement from './utils/errorManagement.js';
// import handleJoiError from './utils/handleJoiError.js';

// const errorDelegatorMiddleware = (error, req, res, next) => {
//   // if (error.isJoi) {
//   //   const appError = handleJoiError(error);
//   //   next(appError);
//   // } else if (error instanceof AppError) {
//   //   error.statusCode = error.statusCode || 500;
//   //   error.status = error.status || 'error';
//   //   console.log('errorDelegatorMiddleware : ', error.message);
//   //   if (res.headersSent) {
//   //     return;
//   //   }
//   //   next(error);
//   // } else if (error instanceof multer.MulterError) {
//   //   applyMulterErrorHandler(error, next);
//   // } else if (error instanceof Error) {
//   //   handleErrors(error, next);
//   // } else {
//   //   // Handle other unknown errors here
//   //   next(new AppError('Unknown error', errorManagement.commonErrors.internalServerError.code, false));
//   // }
//   let appError;

//   if (error.isJoi) {
//     appError = handleJoiError(error);
//   } else if (error instanceof multer.MulterError) {
//     appError = applyMulterErrorHandler(error);
//   } else if (error instanceof AppError) {
//     appError = error;
//   } else if (error instanceof Error) {
//     appError = handleErrors(error);
//   } else {
//     appError = new AppError('Unknown error', errorManagement.commonErrors.internalServerError.code);
//   }

//   // Set default status code if not set
//   appError.statusCode = appError.statusCode || 500;
//   appError.status = appError.status || 'error';

//   if (res.headersSent) {
//     return next(appError);
//   }

//   next(appError);
// };

// export default errorDelegatorMiddleware;
import AppError from './AppError.js';
import multer from 'multer';
import applyMulterErrorHandler from './utils/multerErrorHandling.js';
import handleErrors from './utils/errorHandlers.js';
import errorManagement from './utils/errorManagement.js';
import handleJoiError from './utils/handleJoiError.js';

const errorDelegatorMiddleware = (error, req, res, next) => {
  let appError;

  // Convert various error types to AppError with appropriate error management configs
  if (error.isJoi) {
    appError = handleJoiError(error);
  } else if (error instanceof multer.MulterError) {
    appError = applyMulterErrorHandler(error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      appError = new AppError(
        errorManagement.commonErrors.multerFileSizeLimit.message,
        errorManagement.commonErrors.multerFileSizeLimit.code,
        null,
        errorManagement.errorSeverity.LOW,
        errorManagement.errorSources.CLIENT,
      );
    } else if (error.code === 'LIMIT_FILE_COUNT') {
      appError = new AppError(
        errorManagement.commonErrors.multerFileCount.message,
        errorManagement.commonErrors.multerFileCount.code,
        null,
        errorManagement.errorSeverity.LOW,
        errorManagement.errorSources.CLIENT,
      );
    } else {
      appError = new AppError(
        errorManagement.commonErrors.multerUnsupportedFile.message,
        errorManagement.commonErrors.multerUnsupportedFile.code,
        null,
        errorManagement.errorSeverity.LOW,
        errorManagement.errorSources.CLIENT,
      );
    }
  } else if (error instanceof AppError) {
    appError = error;
  } else if (error.name === 'CastError') {
    appError = new AppError(
      errorManagement.commonErrors.castError.message,
      errorManagement.commonErrors.castError.code,
      null,
      errorManagement.errorSeverity.LOW,
      errorManagement.errorSources.CLIENT,
    );
  } else if (error.code === 11000) {
    // MongoDB duplicate key error
    appError = new AppError(
      errorManagement.commonErrors.duplicateResource.message,
      errorManagement.commonErrors.duplicateResource.code,
      null,
      errorManagement.errorSeverity.LOW,
      errorManagement.errorSources.DATABASE,
    );
  } else {
    appError = new AppError(
      errorManagement.commonErrors.internalServerError.message,
      errorManagement.commonErrors.internalServerError.code,
      null,
      errorManagement.errorSeverity.HIGH,
      errorManagement.errorSources.SERVER,
    );
  }

  if (res.headersSent) {
    return next(appError);
  }

  next(appError);
};

export default errorDelegatorMiddleware;
