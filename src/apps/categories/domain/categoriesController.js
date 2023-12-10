// DB Services
import {
  getCategoriesFromDb,
  getCategoryByIdFromDb,
  addCategoryToDb,
  updateCategoryInDb,
  deleteCategoryInDb,
} from '../../categories/dataAccess/categoryRepository.js';
// error handlers
import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';

// get all categories
export const getCategories = async (req, res, next) => {
  const { filterBy } = req.query;
  const categories = await getCategoriesFromDb(filterBy);
  if (!categories) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  res.status(200).json({
    status: 'success',
    data: categories,
  });
};

// get category by id
export const getCategoryById = async (req, res, next) => {
  const { id } = req.params;
  const category = await getCategoryByIdFromDb(id);

  if (!category) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  res.status(200).json({
    status: 'success',
    data: category,
  });
};

// create a new category
export const createCategory = async (req, res) => {
  const category = await addCategoryToDb(req.body);
  res.status(200).json({
    status: 'success',
    data: category,
  });
};

// update a category
export const updateCategory = async (req, res) => {
  const { id } = req.params;
  const category = await updateCategoryInDb(id, req.body);
  res.status(200).json({
    status: 'success',
    data: category,
  });
};

// delete a message
export const deleteCategory = async (req, res) => {
  const { id } = req.params;
  const category = await deleteCategoryInDb(id);
  res.status(200).json({
    status: 'success',
    data: category,
  });
};
