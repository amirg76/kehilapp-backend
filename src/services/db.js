import mongoose from 'mongoose';
import AppError from '../errors/AppError.js';
import errorManagement from '../errors/utils/errorManagement.js';
import { getMongoUri } from '../config/env.js';
import logger from './logger.js';

export async function connectDB() {
  try {
    await mongoose.connect(getMongoUri());

    // These fire on the event loop, not inside a request. Throwing here would
    // become an uncaughtException, not a handled AppError — so log instead.
    // Mongoose reconnects on its own; the /readyz probe reports the outage.
    mongoose.connection.on('error', (err) => {
      logger.error(`mongo connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('mongo disconnected');
    });
  } catch (err) {
    logger.error(`initial mongo connection failed: ${err.message}`);
    throw new AppError(
      errorManagement.commonErrors.databaseError.message,
      errorManagement.commonErrors.databaseError.code,
      true,
    );
  }
}

export async function closeDatabase() {
  try {
    await mongoose.connection.close();
  } catch (err) {
    logger.error(`error closing mongo: ${err.message}`);
    throw new AppError(
      errorManagement.commonErrors.databaseClosingError.message,
      errorManagement.commonErrors.databaseClosingError.code,
      true,
    );
  }
}
