import errorManagement from './utils/errorManagement.js';
import logger from '../services/logger.js';

const globalErrorHandler = (error, req, res, next) => {
  // Construct the base log message
  let logMessage = `${error.statusCode} - ${error.message} - ${req.originalUrl} - ${req.ip} - ${req.method}`;

  // Add validation errors if they exist
  if (error.validationErrors && error.validationErrors.length > 0) {
    const validationMessages = error.validationErrors.map((err) => `${err.field}: ${err.message}`).join(' | ');
    logMessage += ` - Validation Errors: [${validationMessages}]`;
  }

  // Log with appropriate level based on severity
  const logLevel =
    error.severity === errorManagement.errorSeverity.HIGH
      ? errorManagement.logLevels.ERROR
      : errorManagement.logLevels.INFO;

  logger[logLevel](logMessage);

  // Send standardized error response
  res.status(200).json({
    success: false,
    data: null,
    error: {
      status: error.statusCode,
      message: error.message,
      source: error.source,
      ...(error.validationErrors && { validationErrors: error.validationErrors }),
    },
  });
};

export default globalErrorHandler;
