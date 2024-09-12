import AppError from '../../AppError.js';
import { extractDuplicateEmails } from './extractDuplicateEmails.js';
export const createErrorResponse = (error) => {
  const duplicateEmails = extractDuplicateEmails(error);

  if (duplicateEmails) {
    return new AppError(`Duplicate entries for emails: ${duplicateEmails.join(', ')}`, 400, true);
  }

  if (error.code === 11000) {
    return new AppError('Duplicate entries detected, but unable to extract specific emails', 400, true);
  }

  return new AppError(error.message || 'An error occurred while inserting users', 500, false);
};
