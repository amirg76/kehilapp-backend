/**
 * Test environment defaults.
 *
 * Runs in `setupFiles`, i.e. before the module registry loads any source file.
 * It has to: several modules (notably services/s3.js) read env vars at import
 * time, so assignments made inside a test file are too late — ESM imports are
 * hoisted above them.
 *
 * These are placeholders. Nothing here reaches a real service.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test';
process.env.BUCKET_NAME = process.env.BUCKET_NAME || 'test-bucket';
process.env.BUCKET_REGION = process.env.BUCKET_REGION || 'us-east-1';
process.env.BUCKET_ACCESS_KEY = process.env.BUCKET_ACCESS_KEY || 'test-access-key';
process.env.BUCKET_SECRET_ACCESS_KEY = process.env.BUCKET_SECRET_ACCESS_KEY || 'test-secret-access-key';
