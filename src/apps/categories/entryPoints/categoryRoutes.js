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
  createCategoryImg,
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
  getCategoryByIdValidation,
  // auth,
  getCategoryById,
);

//create new category
router.post(
  '/',
  createCategoryValidation,
  // auth,
  createCategory,
);

//create new category img
router.post(
  '/createImg/:categoryId',
  upload.single('file'),
  // auth,
  createCategoryImg,
);
//update a category
router.patch(
  '/:id',
  updateCategoryValidation,
  // auth,
  updateCategory,
);

//delete a category
router.delete(
  '/:id',
  deleteCategoryValidation,
  // auth,
  deleteCategory,
);

export default router;
