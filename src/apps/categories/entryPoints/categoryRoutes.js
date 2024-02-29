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
router.get('/', getCategories);

//get category by id
router.get('/:id', getCategoryByIdValidation, getCategoryById);

//create new category
router.post('/', upload.single('file'), createCategoryValidation, createCategory);

//update a category
router.patch('/:id', upload.single('file'), updateCategoryValidation, updateCategory);

//delete a category
router.delete('/:id', deleteCategoryValidation, deleteCategory);

export default router;
