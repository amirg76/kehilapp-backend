import express from 'express';
// authentication + authorization
import auth from '../../../middlewares/auth.js';
import requireRole from '../../../middlewares/requireRole.js';
// validation
import {
  getCategoryByIdValidation,
  createCategoryValidation,
  updateCategoryValidation,
  deleteCategoryValidation,
} from './categoriesValidation.js';
//upload middleware
import upload from '../../../middlewares/multer.js';
// controllers
import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../domain/categoriesController.js';

const router = express.Router();

// Categories are the structure the messages hang off, not content. Everyone
// signed in can read them; only an admin can reshape them.
// Public read (see messageRoutes for the rationale).
router.get('/', getCategories);
router.get('/:id', getCategoryByIdValidation, getCategoryById);

router.post('/', auth, requireRole('admin'), upload.single('file'), createCategoryValidation, createCategory);
router.patch('/:id', auth, requireRole('admin'), upload.single('file'), updateCategoryValidation, updateCategory);
router.delete('/:id', auth, requireRole('admin'), deleteCategoryValidation, deleteCategory);

export default router;
