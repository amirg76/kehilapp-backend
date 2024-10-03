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
export const manyUsers = async (users) => {
  return await UserModel.insertMany(users, { ordered: false });
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
