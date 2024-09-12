import express from 'express';
import auth from '../../../middlewares/auth.js';
import { getUserByIdValidation } from './usersValidation.js';
import * as usersController from '../domain/usersController.js';

const router = express.Router();

//create many users
router.post(
  '/createMany',
  // auth,
  usersController.createManyUsers,
);
//get all messages
router.get(
  '/',
  // auth,
  usersController.getUsers,
);

router.get(
  // if we wouldn't get the userId from auth, we would get it from the params
  '/:userId',
  getUserByIdValidation,
  //TODO: check the problem with the auth middleware. it throws an unauthorized error.
  // auth,
  usersController.getUserById,
);

export default router;
