import { createServer } from 'http';
import 'dotenv/config';
// import { config } from 'dotenv-flow'; //! replaced with regular dotenv library, bug fix
import { connectDB } from './services/db.js';
import app from './app.js';
import logger from './services/logger.js';
import AppError from './errors/AppError.js';
import errorManagement from './errors/utils/errorManagement.js';

// config({ path: './config/' }); //! replaced with regular dotenv library, bug fix
connectDB()
  .then(() => logger.info('DB connected'))
  .catch(() => {
    throw new AppError(
      errorManagement.commonErrors.databaseError.message,
      errorManagement.commonErrors.databaseError.code,
      true,
    );
  });
const httpServer = createServer(app);
const port = process.env.PORT || 5001;
httpServer.listen(port, () => {
  logger.info(`server listening on port ${port} (${process.env.NODE_ENV || 'default'} mode)`);
});

// Finish in-flight requests before exiting, so a deploy or scale-down event
// never cuts a response off mid-body. Docker sends SIGTERM on `docker stop`.
const shutdown = (signal) => {
  logger.info(`${signal} received, closing server`);
  httpServer.close(() => {
    logger.info('server closed');
    process.exit(0);
  });
  // Hard stop if something keeps the event loop alive past the grace period.
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
