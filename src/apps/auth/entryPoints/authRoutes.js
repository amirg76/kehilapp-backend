import express from 'express';
import auth from '../../../middlewares/auth.js';
import * as authController from '../domain/authController.js';
import { validateUser } from '../../users/entryPoints/usersValidation.js';

const router = express.Router();

//get all messages
router.post('/register', validateUser, authController.registerUser);
router.post('/login', validateUser, authController.login);

export default router;
