import express from 'express';
import auth from '../../../middlewares/auth.js';
import requireRole from '../../../middlewares/requireRole.js';
import { getUserByIdValidation } from './usersValidation.js';
import * as usersController from '../domain/usersController.js';

const router = express.Router();

// The full member directory is admin-only: it is the one endpoint that hands
// back every account in the system at once.
router.get('/', auth, requireRole('admin'), usersController.getUsers);

router.get('/:userId', auth, getUserByIdValidation, usersController.getUserById);

export default router;
