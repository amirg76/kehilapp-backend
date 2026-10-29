const getEnvVariable = (varName) => {
  const value = process.env[varName];
  if (!value) {
    throw new Error(`${varName} is not defined in .env file`);
  }
  return value;
};

// Same lookup, but absence is a valid answer: returns '' instead of throwing.
const getOptionalEnvVariable = (varName) => process.env[varName] || '';

export const getJwtSecret = () => getEnvVariable('JWT_SECRET');

export const getMongoUri = () => getEnvVariable('MONGO_URI');

export const getBucketName = () => getEnvVariable('BUCKET_NAME');

export const getBucketRegion = () => getEnvVariable('BUCKET_REGION');

export const getBucketAccessKey = () => getEnvVariable('BUCKET_ACCESS_KEY');

export const getBucketSecretAccessKey = () => getEnvVariable('BUCKET_SECRET_ACCESS_KEY');

// Optional. Set only for an S3-compatible service that is not AWS (Cloudflare R2,
// MinIO). Empty when unset, so an AWS deployment is unaffected.
export const getBucketEndpoint = () => getOptionalEnvVariable('BUCKET_ENDPOINT');
