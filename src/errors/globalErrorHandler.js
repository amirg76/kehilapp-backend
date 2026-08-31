import errorManagement from './utils/errorManagement.js';
import logger from '../services/logger.js';

/**
 * Terminal error handler. Turns any error into an HTTP response.
 *
 * It used to call process.exit(1) on any non-operational error. That made the
 * whole server killable by a single malformed request — an unauthenticated
 * remote denial of service. An HTTP handler's job is to answer the request, not
 * to decide the process should die; a crash-only-supervisor strategy, if wanted,
 * belongs at the top level (uncaughtException), never here per-request.
 */
const globalErrorHandler = (error, req, res, next) => {
  const statusCode = error.statusCode || errorManagement.commonErrors.internalServerError.code;

  // A non-operational error is a bug, not an expected condition. Log it in full,
  // but never hand its message to the client — it can carry internals.
  if (!error.isOperational) {
    logger.error(`unhandled ${statusCode} ${req.method} ${req.originalUrl} - ${error.stack || error.message}`);
  } else {
    logger.warn(`${statusCode} ${req.method} ${req.originalUrl} - ${error.message}`);
  }

  const clientMessage = error.isOperational ? error.message : errorManagement.commonErrors.internalServerError.message;

  // If headers already went out, delegate to Express's default handler.
  if (res.headersSent) return next(error);

  return res.status(statusCode).json({ error: clientMessage });
};

export default globalErrorHandler;
