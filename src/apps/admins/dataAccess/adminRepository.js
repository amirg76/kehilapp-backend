import UserModel from '../../users/dataAccess/userModel.js';

// const users = [
//   {
//     firstName: 'John',
//     lastName: 'Doe',
//     email: 'john@example.com',
//     password: 'password123',
//     phone: '1234567890',
//     passport: '123456789',
//   },
//   {
//     firstName: 'Jane',
//     lastName: 'Smith',
//     email: 'jane@example.com',
//     password: 'password123',
//     phone: '0987654321',
//     passport: '987654321',
//   },
//   // Add more users here...
// ];

export const createUser = async (newUser) => {
  const newUserCreate = new UserModel(newUser);
  return await newUserCreate.save();
};
export const manyUsers = async (users) => {
  return await UserModel.insertMany(users, { ordered: false });
};

export const deleltedItemOnDb = async (id) => {
  return await UserModel.deleteOne({ _id: id });
};

export const updateItemOnDb = async (id, updateData) => {
  return await UserModel.updateOne({ _id: id }, { $set: updateData });
};
export const deleteUsers = async () => {
  return await UserModel.deleteMany({});
};
export const createAdmin = async ({ email, password }) => {
  return await UserModel.create({ email, password });
};

export const getAdminsFromDb = async () => {
  return UserModel.find();
};

export const getAdminFromDb = async (id) => {
  return UserModel.findById(id);
};

export const getAdminByEmailFromDb = async (email) => {
  return UserModel.findOne({ email });
};
