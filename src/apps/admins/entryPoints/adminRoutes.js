import express from 'express';
import auth from '../../../middlewares/auth.js';
import { validateAdminLogin } from './adminValidation.js';
import * as adminController from '../domain/adminController.js';
import * as authController from '../../auth/domain/authController.js';
import { validateUser } from '../../users/entryPoints/usersValidation.js';
import protectAdminRoute from '../../../middlewares/protectAdminRoute.js';
import multer from 'multer';
const router = express.Router();
const upload = multer({ dest: 'uploads/' });
// admin login
router.post('/login', validateUser, validateAdminLogin, authController.login);
//create many users
router.post('/add-many-users', auth, protectAdminRoute, upload.single('file'), adminController.createManyUsers);
router.post('/delete-many-users', auth, protectAdminRoute, adminController.deleteManyUsers);
router.post('/add-user', auth, protectAdminRoute, adminController.createNewUser);
router.post('/delete-table-item', auth, protectAdminRoute, adminController.deleteItemFromTable);
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
