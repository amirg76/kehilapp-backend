import AppError from '../AppError.js';
import errorManagement from './errorManagement.js';
const handleJoiError = (error) => {
  const validationErrors = error.details.map((detail) => ({
    field: detail.path[0],
    message: detail.message,
  }));

  return new AppError(
    errorManagement.commonErrors.validationError.message,
    errorManagement.commonErrors.validationError.code,
    validationErrors,
    errorManagement.errorSeverity.LOW,
    errorManagement.errorSources.CLIENT,
  );
};

export default handleJoiError;
