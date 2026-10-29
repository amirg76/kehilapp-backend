import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import {
  getBucketName,
  getBucketRegion,
  getBucketAccessKey,
  getBucketSecretAccessKey,
  getBucketEndpoint,
} from '../config/env.js';

// Builds the S3Client options. Pure, so both shapes can be asserted without a
// network. With no endpoint this is exactly the AWS config used before: the SDK
// derives the host from the region. With an endpoint (Cloudflare R2, MinIO, any
// S3-compatible service) the SDK is pointed at that host, and path-style
// addressing puts the bucket in the URL path rather than the hostname — the
// form every such service accepts.
export const buildS3ClientConfig = ({ endpoint, region, accessKeyId, secretAccessKey }) => {
  const config = {
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    region,
  };
  if (typeof endpoint === 'string' && endpoint.length > 0) {
    config.endpoint = endpoint;
    config.forcePathStyle = true;
  }
  return config;
};

const s3 = new S3Client(
  buildS3ClientConfig({
    endpoint: getBucketEndpoint(),
    region: getBucketRegion(),
    accessKeyId: getBucketAccessKey(),
    secretAccessKey: getBucketSecretAccessKey(),
  }),
);

// upload a file to the bucket, if file is passed a unique key will be returned
export const uploadFileToBucket = async (directory, file) => {
  if (file) {
    const fileKey = uuidv4();
    const command = new PutObjectCommand({
      Bucket: getBucketName(),
      Key: `${directory}/${fileKey}`,
      Body: file.buffer,
      ContentType: file.mimetype,
      // Force a download instead of inline rendering, so a booby-trapped file
      // (e.g. an SVG or HTML that slipped past the filter) cannot execute in
      // the storage origin when its signed URL is opened.
      ContentDisposition: 'attachment',
    });
    await s3.send(command);
    return fileKey;
  }
};

// upload a file with the same key to replace the existing file
export const updateFileInBucket = async (directory, existingKey, file) => {
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: `${directory}/${existingKey}`,
    Body: file.buffer,
    ContentType: file.mimetype,
    ContentDisposition: 'attachment',
  });
  return await s3.send(command);
};

// generate a link to file, valid for 60 minutes
export const getFileSignedURL = async (directory, key) => {
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: `${directory}/${key}`,
  });
  return await getSignedUrl(s3, command, { expiresIn: 3600 }); //link valid for 60 minutes
};

// delete a file from S3 bucket
export const deleteFileFromBucket = async (directory, key) => {
  const command = new DeleteObjectCommand({
    Bucket: getBucketName(),
    Key: `${directory}/${key}`,
  });
  return await s3.send(command);
};
