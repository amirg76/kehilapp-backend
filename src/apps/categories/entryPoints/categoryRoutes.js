import express from 'express';
// authentication
// import auth from '../../../middlewares/auth.js';
// validation
import {
  getCategoryByIdValidation,
  createCategoryValidation,
  updateCategoryValidation,
  deleteCategoryValidation,
} from './categoriesValidation.js';
// controllers
import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../domain/categoriesController.js';

import upload from '../../../middlewares/multer.js';
const router = express.Router();

//get all categories
router.get(
  '/',
  // auth,
  getCategories,
);

//get category by id
router.get(
  '/:id',
  // getCategoryByIdValidation,
  // auth,
  getCategoryById,
);

//create new category
router.post(
  '/',
  upload.single('file'),
  // createCategoryValidation,
  // auth,
  createCategory,
);

//update a category
router.patch(
  '/:id',
  upload.single('file'),
  // updateCategoryValidation,
  // auth,
  updateCategory,
);

//delete a category
router.delete(
  '/:id',
  // deleteCategoryValidation,
  // auth,
  deleteCategory,
);

export default router;
