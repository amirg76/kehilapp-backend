import UserModel from './userModel.js';

const users = [
  {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    password: 'password123',
    phone: '1234567890',
    passport: '123456789',
  },
  {
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane@example.com',
    password: 'password123',
    phone: '0987654321',
    passport: '987654321',
  },
  // Add more users here...
];

export const createUser = async (user) => {
  const newUser = new UserModel(user);

  return await newUser.save();
};

export const getUsersFromDb = async (filter) => {
  return UserModel.find(filter);
};

export const getUserFromDb = async (id) => {
  return UserModel.findById(id);
};

export const getUserByEmailFromDb = async (email) => {
  return UserModel.findOne({ email });
};
