import express from 'express';
import auth from '../../../middlewares/auth.js';
import requireRole from '../../../middlewares/requireRole.js';
import { approvalValidation, getUserByIdValidation, roleChangeValidation } from './usersValidation.js';
import * as usersController from '../domain/usersController.js';

const router = express.Router();

// The full member directory is admin-only: it is the one endpoint that hands
// back every account in the system at once.
router.get('/', auth, requireRole('admin'), usersController.getUsers);

router.get('/:userId', auth, getUserByIdValidation, usersController.getUserById);

// Admitting a resident to the community — and withdrawing that admission — is an
// admin act, so both carry requireRole on top of auth. PATCH is not CSRF-exempt,
// so a cookie-authenticated caller must also echo the CSRF token.
router.patch('/:userId/approve', auth, requireRole('admin'), approvalValidation, usersController.approveUser);
router.patch('/:userId/revoke', auth, requireRole('admin'), approvalValidation, usersController.revokeUser);

// Changing a role is the only way to take an admin's powers away — revoking
// their approval takes nothing, which is why that route refuses and points here.
// Admin-only for the same reason as the two above, and listed in
// ADMIN_ONLY_ROUTES in the route-guard test so a dropped guard is caught.
router.patch('/:userId/role', auth, requireRole('admin'), roleChangeValidation, usersController.changeUserRole);

export default router;
