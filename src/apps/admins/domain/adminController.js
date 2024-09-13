import {
  getAdminByEmailFromDb,
  getAdminFromDb,
  getAdminsFromDb,
  createAdmin,
  manyUsers,
} from '../../../apps/admins/dataAccess/adminRepository.js';
import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';
import { createErrorResponse } from '../../../errors/utils/mongoDbErrorHandler/createErrorResponse.js';
export const createManyUsers = async (req, res, next) => {
  try {
    const Users = await manyUsers();

    if (Users) {
      return res.status(200).json({ message: 'Users created successfully' });
    }
  } catch (error) {
    next(createErrorResponse(error));
  }
  // res.status(200).json(Admins);
};

export const getAdmins = async (req, res, next) => {
  const Admins = await getAdminsFromDb();
  if (!Admins || !Admins.length) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  res.status(200).json(Admins);
};

export const getAdminById = async (req, res, next) => {
  const { AdminId } = req.params;
  const Admin = await getAdminFromDb(AdminId);

  if (!Admin) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  res.status(200).json(Admin);
};

// A function to get a Admin by email from the database
export const findAdminByEmail = async (email) => {
  try {
    const Admin = await getAdminByEmailFromDb(email);

    return Admin;
  } catch (error) {
    throw new Error('Error fetching Admin from the database');
  }
};

export const getAdminByEmail = async (email, next) => {
  try {
    const Admin = await getAdminByEmailFromDb(email);

    return Admin;
  } catch (error) {
    next(error);
  }
};
