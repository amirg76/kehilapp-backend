// DB Services
import {
  getCategoriesFromDb,
  getCategoryByIdFromDb,
  addCategoryToDb,
  updateCategoryInDb,
  deleteCategoryInDb,
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
  if (!categories || !categories.length) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  // get file signed url for all uploaded attachments
  for (const category of categories) {
    const url = await getFileSignedURL('categories', category.attachmentKey);
    category.coverImgUrl = url;
  }
  res.status(200).json(categories);
};

// get category by id
export const getCategoryById = async (req, res, next) => {
  const { id } = req.params;
  const category = await getCategoryByIdFromDb(id);

  if (!category || !category.length) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }
  const url = await getFileSignedURL('categories', category.attachmentKey);
  category.coverImgUrl = url;

  res.status(200).json(category);
};

// create a new category
export const createCategory = async (req, res) => {
  const { title, managedBy, icon, categoryColor } = req.body;
  const file = req.file;

  const attachmentKey = await uploadFileToBucket('categories', file);
  let category = await addCategoryToDb(title, managedBy, icon, categoryColor, attachmentKey);

  category = category.toObject();
  const url = await getFileSignedURL('categories', attachmentKey);
  category.coverImgUrl = url;

  res.status(200).json(category);
};

// update a category
export const updateCategory = async (req, res) => {
  const { id } = req.params;
  const { title, managedBy, icon, categoryColor } = req.body;
  const file = req.file;

  let category = await updateCategoryInDb(id, title, managedBy, icon, categoryColor);

  if (file) {
    await updateFileInBucket('categories', category.attachmentKey, file);
  }

  category = category.toObject();
  const url = await getFileSignedURL('categories', category.attachmentKey);
  category.coverImgUrl = url;

  res.status(200).json(category);
};

// delete a message
export const deleteCategory = async (req, res) => {
  const { id } = req.params;
  const category = await deleteCategoryInDb(id);
  await deleteFileFromBucket('categories', category.attachmentKey);
  res.status(200).send('deleted successfully');
};
