// DB Services
import {
  getCategoriesFromDb,
  getCategoryByIdFromDb,
  addCategoryToDb,
  updateCategoryInDb,
  deleteCategoryInDb,
  addCategoryImgInDb,
} from '../../categories/dataAccess/categoryRepository.js';
import {
  uploadFileToBucket,
  getFileSignedURL,
  updateFileInBucket,
  deleteFileFromBucket,
} from '../../../services/s3.js';
// error handlers
import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';

// get all categories
export const getCategories = async (req, res, next) => {
  const categories = await getCategoriesFromDb();
  if (!categories) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  // get file signed url for all uploaded attachments
  for (const category of categories) {
    if (category.attachmentKey) {
      const url = await getFileSignedURL('categories', category.attachmentKey);
      category.coverImgUrl = url;
    }
  }
  res.status(200).json(categories);
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
  if (category.attachmentKey) {
    const url = await getFileSignedURL('categories', category.attachmentKey);
    category.coverImgUrl = url;
  }
  res.status(200).json(category);
};

// create a new category
export const createCategory = async (req, res) => {
  const category = await addCategoryToDb(req.body);

  res.status(200).json(category);
};

// update a category
export const updateCategory = async (req, res) => {
  const { id } = req.params;
  const category = await updateCategoryInDb(id, req.body);

  res.status(200).json(category);
};

// delete a message
export const deleteCategory = async (req, res) => {
  const { id } = req.params;
  await deleteCategoryInDb(id);
  res.status(200).send('deleted successfully');
};

// create a new category img
export const createCategoryImg = async (req, res) => {
  const { categoryId } = req.params;
  const file = req.file;

  let attachmentKey; //attachment file properties
  if (file) {
    attachmentKey = await uploadFileToBucket('categories', file);
  }
  const category = await addCategoryImgInDb(categoryId, attachmentKey);

  res.status(200).json(category);
};
