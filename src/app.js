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
  console.error(err); // Log the error for debugging

  const statusCode = err.statusCode || 500;
  const message = err.message || 'An error occurred';

  res.status(statusCode).json({
    success: false,
    data: null,
    error: {
      status: statusCode,
      message: message,
    },
  });
});
// Middleware to handle all responses
app.use((req, res, next) => {
  res.sendResponse = function (data, statusCode = 200) {
    this.status(statusCode).json({
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

  next();
});

export default app;
