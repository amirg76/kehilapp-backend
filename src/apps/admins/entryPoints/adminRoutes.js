import express from 'express';
import auth from '../../../middlewares/auth.js';
import { validateAdmin } from './adminValidation.js';
import * as adminController from '../domain/adminController.js';
import * as authController from '../../auth/domain/authController.js';
import { validateUser } from '../../users/entryPoints/usersValidation.js';

const router = express.Router();

// admin login
router.post('/login', validateUser, auth, validateAdmin, authController.login);
//create many users
router.post(
  '/createMany',
  // auth,
  validateUser,
  validateAdmin,
  adminController.createManyUsers,
);
// //get all messages
// router.get(
//   '/',
//   // auth,
//   usersController.getUsers,
// );

// router.get(
//   // if we wouldn't get the userId from auth, we would get it from the params
//   '/:userId',
//   getUserByIdValidation,
//   //TODO: check the problem with the auth middleware. it throws an unauthorized error.
//   // auth,
//   usersController.getUserById,
// );

export default router;
