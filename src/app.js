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
import usersRoutes from './apps/users/entryPoints/userRoutes.js'

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


app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404, true));
});

// Error handling
app.use(errorDelegatorMiddleware);
app.use(globalErrorHandler);

export default app;
