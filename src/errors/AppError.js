class AppError extends Error {
  constructor(message, statusCode, validationErrors = null, severity = 'LOW', source = 'SERVER') {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.validationErrors = validationErrors;
    this.severity = severity;
    this.source = source;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
