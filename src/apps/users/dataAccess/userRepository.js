import UserModel from './userModel.js';

export const createUser = async ({ email, password }) => {
  return await UserModel.create({ email, password });
};

export const getUsersFromDb = async () => {
  return UserModel.find();
};

export const getUserFromDb = async (id) => {
  return UserModel.findById(id);
};

export const getUserByEmailFromDb = async (email) => {
  return UserModel.findOne({ email });
};
