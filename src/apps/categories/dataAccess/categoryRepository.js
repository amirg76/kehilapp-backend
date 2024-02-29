import CategoryModel from './categoryModel.js';

export const getCategoriesFromDb = async () => {
  return await CategoryModel.find({}).sort({ createdAt: 1 }).lean(); //sorted as created first shown first
};

export const getCategoryByIdFromDb = async (id) => {
  return await CategoryModel.findById(id).lean();
};

export const addCategoryToDb = async (title, managedBy, icon, categoryColor, attachmentKey) => {
  return await CategoryModel.create({ title, managedBy, icon, categoryColor, attachmentKey });
};

export const updateCategoryInDb = async (id, title, managedBy, icon, categoryColor) => {
  return await CategoryModel.findByIdAndUpdate(id, { title, managedBy, icon, categoryColor }, { new: true });
};

export const deleteCategoryInDb = async (id) => {
  return await CategoryModel.findByIdAndDelete(id);
};
