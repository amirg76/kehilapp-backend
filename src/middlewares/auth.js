import pkg from 'jsonwebtoken';
import errorManagement from '../errors/utils/errorManagement.js';
import AppError from '../errors/AppError.js';
import User from '../apps/users/dataAccess/userModel.js';
import { getJwtSecret } from '../config/env.js';
import jwt from 'jsonwebtoken';

const { verify } = pkg;

const throwUnauthorizedError = () =>
  new AppError(
    errorManagement.commonErrors.authenticationError.message,
    errorManagement.commonErrors.authenticationError.code,
    true,
  );

const verifyToken = async (token, next) =>
  new Promise((resolve, reject) => {
    jwt.verify(token, getJwtSecret(), (err, decoded) => {
      if (err) {
        next(throwUnauthorizedError());
        resolve(undefined);
      } else if (typeof decoded === 'object' && decoded !== null && 'id' in decoded && 'role' in decoded) {
        resolve(decoded);
      } else {
        console.log('role' in decoded);

        resolve(undefined);
      }
    });
  });

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer')) {
      return next(throwUnauthorizedError());
    }

    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // const [prefix, token, ...rest] = authHeader.split(' ');
    // if (prefix !== 'Bearer' || !token || rest.length > 0) {
    //   return next(throwUnauthorizedError());
    // }
    // console.log('auth', token);

    const decoded = await verifyToken(token, next);

    if (!decoded) {
      return next(throwUnauthorizedError());
    }

    const { id, role } = decoded;

    const user = await User.findById(id);

    if (!user) return next(throwUnauthorizedError());

    req.id = id;
    req.role = role;

    next();
  } catch (err) {
    if (err instanceof Error) {
      next(new AppError(err.message, errorManagement.commonErrors.internalServerError.code, false));
    } else {
      next(new AppError('An unknown error occurred', errorManagement.commonErrors.internalServerError.code, false));
    }
  }
};

export default auth;
