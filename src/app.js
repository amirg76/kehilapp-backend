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

app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404, true));
});

app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (body) {
    if (this.statusCode >= 400) {
      // For error responses, we'll send a 200 OK with the error details in the body
      return originalJson.call(this, {
        success: false,
        error: {
          status: this.statusCode,
          message: body.message || 'An error occurred',
        },
      });
    }
    return originalJson.call(this, { success: true, data: body });
  };
  next();
});
// Error handling
app.use(errorDelegatorMiddleware);
app.use(globalErrorHandler);

export default app;
