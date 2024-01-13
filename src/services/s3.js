import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { getBucketName, getBucketRegion, getBucketAccessKey, getBucketSecretAccessKey } from '../config/env.js';

const s3 = new S3Client({
  credentials: {
    accessKeyId: getBucketAccessKey(),
    secretAccessKey: getBucketSecretAccessKey(),
  },
  region: getBucketRegion(),
});

// upload a file to aws S3 bucket, if file is passed a unique key will be returned
export const uploadFileToBucket = async (file) => {
  if (file) {
    const fileKey = uuidv4();
    const command = new PutObjectCommand({
      Bucket: getBucketName(),
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    });
    await s3.send(command);
    return fileKey;
  }
};

// upload a file with the same key to replace the existing file
export const updateFileInBucket = async (file, existingKey) => {
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: existingKey,
    Body: file.buffer,
    ContentType: file.mimetype,
  });
  return await s3.send(command);
};

// generate a link to file, valid for 60 minutes
export const getFileSignedURL = async (key) => {
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return await getSignedUrl(s3, command, { expiresIn: 3600 }); //link valid for 60 minutes
};

// delete a file from S3 bucket
export const deleteFileFromBucket = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return await s3.send(command);
};
