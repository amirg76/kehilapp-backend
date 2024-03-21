import mongoose from 'mongoose';
import AppError from '../errors/AppError.js';
import errorManagement from '../errors/utils/errorManagement.js';
import { getMongoUri, getMongoUriDev } from '../config/env.js';

export async function connectDB() {
  try {
    console.log(process.env.NODE_ENV);
    // await mongoose.connect(process.env.NODE_ENV === 'dev' ? getMongoUriDev() : getMongoUri());
    await mongoose.connect(getMongoUri());

    mongoose.connection.on('error', (err) => {
      throw new AppError(
        errorManagement.commonErrors.databaseError.message,
        errorManagement.commonErrors.databaseError.code,
        true,
      );
    });

    mongoose.connection.on('disconnected', () => {
      throw new AppError('Database disconnected', 500, true);
    });
  } catch (_) {
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
    throw new AppError(
      errorManagement.commonErrors.databaseClosingError.message,
      errorManagement.commonErrors.databaseClosingError.code,
      true,
    );
  }
}
