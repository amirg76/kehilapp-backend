const getEnvVariable = (varName) => {
  const value = process.env[varName];
  if (!value) {
    throw new Error(`${varName} is not defined in .env file`);
  }
  return value;
};

export const getJwtSecret = () => getEnvVariable('JWT_SECRET');

export const getMongoUri = () => getEnvVariable('MONGO_URI');

export const getMongoUriDev = () => getEnvVariable('MONGO_URI_DEV');

export const getBucketName = () => getEnvVariable('BUCKET_NAME');

export const getBucketRegion = () => getEnvVariable('BUCKET_REGION');

export const getBucketAccessKey = () => getEnvVariable('BUCKET_ACCESS_KEY');

export const getBucketSecretAccessKey = () => getEnvVariable('BUCKET_SECRET_ACCESS_KEY');
