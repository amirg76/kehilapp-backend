import express from 'express';
import auth from '../../../middlewares/auth.js';
import { getUserByIdValidation } from './authValidation.js';
import * as  authController from '../domain/authController.js';

const router = express.Router();

//get all messages
router.get(
  '/login',
  // auth,
  authController.login,
);

export default router;
