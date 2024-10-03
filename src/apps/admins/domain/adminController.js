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
import { readExcelFile } from '../services/adminServices.js';
import bcrypt from 'bcryptjs';
export const createManyUsers = async (req, res, next) => {
  try {
    const file = req.file;

    if (!file) {
      return next(new AppError('Invalid file or data', 400));
    }
    // Read the Excel file
    const data = readExcelFile(file);

    // Process and validate data
    const processedData = await Promise.all(
      data.map(async (row) => {
        return {
          firstName: row.firstName,
          lastName: row.lastName,
          role: row.role,
          email: row.email,
          password: await bcrypt.hash(String(row.password).trim(), 10),
          // Add more fields as needed
        };
      }),
    );

    const Users = await manyUsers(processedData);

    if (Users) {
      return res.status(200).json({ message: 'Users created successfully' });
    }
  } catch (error) {
    next(createErrorResponse(error));
  }
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
