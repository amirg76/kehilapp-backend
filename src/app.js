import 'express-async-errors';
// import 'module-alias/register.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import globalErrorHandler from './errors/globalErrorHandler.js';
import catchProgrammingErrors from './errors/catchProgrammingErrors.js';
import AppError from './errors/AppError.js';
import corsMiddleware from './middlewares/cors.js';
//import routes
// import userRoutes from './apps/users/entryPoints/userRoutes.js';
import messagesRoutes from './apps/messages/entryPoints/messageRoutes.js';
import categoriesRoutes from './apps/categories/entryPoints/categoryRoutes.js';

const app = express();

// middlewares
app.use(cookieParser());
app.use(corsMiddleware);
app.use(express.json());
//route logger
app.use((req, res, next) => {
  console.log(req.method, req.path);
  next();
});

// Routes
// app.use('/users', userRoutes); //? route not used currently
app.use('/api/messages', messagesRoutes);
app.use('/api/categories', categoriesRoutes);

app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404, true));
});

// Error handling
app.use(catchProgrammingErrors);
app.use(globalErrorHandler);

export default app;
