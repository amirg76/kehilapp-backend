export const extractDuplicateEmails = (error) => {
  if (error.code !== 11000) {
    return null;
  }

  let duplicateEmails = [];

  if (error.writeErrors && Array.isArray(error.writeErrors)) {
    duplicateEmails = error.writeErrors.map((err) => err.err?.op?.email).filter(Boolean);
  } else if (error.keyValue?.email) {
    duplicateEmails.push(error.keyValue.email);
  }

  return duplicateEmails.length > 0 ? duplicateEmails : null;
};
