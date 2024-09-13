import 'express-async-errors';
import express from 'express';

import cookieParser from 'cookie-parser';
import globalErrorHandler from './errors/globalErrorHandler.js';
import errorDelegatorMiddleware from './errors/errorDelegatorMiddleware.js';
import AppError from './errors/AppError.js';
import corsMiddleware from './middlewares/cors.js';

//import routes
import messagesRoutes from './apps/messages/entryPoints/messageRoutes.js';
import categoriesRoutes from './apps/categories/entryPoints/categoryRoutes.js';
import usersRoutes from './apps/users/entryPoints/userRoutes.js';
import authRoutes from './apps/auth/entryPoints/authRoutes.js';
import adminRoutes from './apps/admins/entryPoints/adminRoutes.js';

const app = express();

// middlewares
app.use(cookieParser());
app.use(corsMiddleware);
app.use(express.json());
//route console logger
app.use((req, res, next) => {
  console.log(req.method, req.path);
  next();
});

// Routes
app.use('/api/messages', messagesRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Error handling
app.use(errorDelegatorMiddleware);
app.use(globalErrorHandler);

// Error handling middleware
app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.message = err.message || 'Internal server error';

  if (process.env.NODE_ENV === 'development') {
    console.error('Error 🔥', err);
  }

  res.status(err.statusCode).send({ message: err.message });
});
// Middleware to handle all responses
app.use((req, res, next) => {
  res.sendResponse = function (data, statusCode = 200) {
    this.status(200).json({
      success: statusCode < 400,
      data: statusCode < 400 ? data : null,
      error:
        statusCode >= 400
          ? {
              status: statusCode,
              message: data.message || 'An error occurred',
            }
          : null,
    });
  };
  console.log(res.sendResponse);

  next();
});

export default app;
