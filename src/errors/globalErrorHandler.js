import errorManagement from './utils/errorManagement.js'; // Update path as needed
import logger from '../services/logger.js';
import AppError from './AppError.js';

const globalErrorHandler = (error, req, res, next) => {
  const statusCode = error.statusCode || errorManagement.commonErrors.internalServerError.code;
  console.log('globalErrorHandler : ', error.message);

  const message = error.message || errorManagement.commonErrors.internalServerError.message;

  // You can uncomment and modify the following lines if needed
  logger.error(`${statusCode} - ${message} - ${req.originalUrl} - ${req.ip} - ${req.method}`);
  // if (error.severity === errorManagement.errorSeverity.HIGH) {
  //   mailer.sendMail(configuration.adminMail, "Critical error occurred", error);
  // }

  // if (!error.isOperational) {
  //   process.exit(1);
  // }
  const isOperationalError = error instanceof AppError;
  const errorMessage = isOperationalError ? error.message : 'An unexpected error occurred';

  res.status(200).json({
    success: false,
    error: {
      status: error.statusCode || 500,
      message: errorMessage,
    },
  });
};

export default globalErrorHandler;
