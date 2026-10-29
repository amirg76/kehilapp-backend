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
// form R2 and MinIO document.
//
// The endpoint is validated here, at startup, rather than on the first upload:
// a malformed value would otherwise surface as "Invalid URL" on a user's first
// attachment, and a plain-http endpoint in production would send object keys,
// the access key id and request signatures in clear text (merge gate, 29.10).
export const buildS3ClientConfig = ({
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
  nodeEnv = process.env.NODE_ENV,
}) => {
  const config = {
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    region,
  };
  const trimmed = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (trimmed.length > 0) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error('BUCKET_ENDPOINT is not a valid URL');
    }
    if (parsed.protocol !== 'https:' && nodeEnv === 'production') {
      throw new Error('BUCKET_ENDPOINT must use https in production');
    }
    config.endpoint = trimmed;
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
