import express from 'express';
import auth from '../../../middlewares/auth.js';
import * as  authController from '../domain/authController.js';

const router = express.Router();

//get all messages
router.post(
  '/login',
  // auth,
  authController.login,
);

export default router;
