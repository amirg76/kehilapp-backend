import CategoryModel from './categoryModel.js';

export const getCategoriesFromDb = async (filterBy) => {
  return await CategoryModel.find({}).sort({ createdAt: 1 }); //sorted as created first shown first
};

export const getCategoryByIdFromDb = async (id) => {
  return await CategoryModel.findById(id);
};

export const addCategoryToDb = async (category) => {
  return await CategoryModel.create(category);
};

export const updateCategoryInDb = async (id, updatedCategory) => {
  return await CategoryModel.findByIdAndUpdate(id, updatedCategory, { new: true });
};

export const deleteCategoryInDb = async (id) => {
  return await CategoryModel.findByIdAndDelete(id);
};

export const addCategoryImgInDb = async (categoryId, attachmentKey) => {
  return await CategoryModel.findByIdAndUpdate(categoryId, { attachmentKey }, { new: true });
};
