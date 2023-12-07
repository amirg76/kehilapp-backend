import CategoryModel from './categoryModel.js';

// TODO: filtering dynamically by field
export const getCategoriesFromDb = async (filterBy) => {
  return await CategoryModel.find(filterBy).sort({ createdAt: -1 }); //sorted as created last shown first
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
