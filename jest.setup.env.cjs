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

/**
 * NOT a placeholder — a deliberate choice, and the two lines below are a pair.
 *
 * The suite drives the registration flow end to end, which means it needs the
 * verification token back from the response. That is exactly the exposure the
 * production gate exists to deny, so the suite opts IN by name rather than
 * inheriting it from a permissive default. Tests that assert the gate is CLOSED
 * override this locally; see registration.int.test.js.
 *
 * And the provider is forced empty so that no test can ever reach a real mail
 * API. Nothing loads dotenv under jest today (only src/index.js does), so this
 * is belt and braces — but the failure it prevents is a suite that mails a live
 * provider a few hundred times, which is not a failure worth discovering.
 */
process.env.EXPOSE_VERIFICATION_LINK = 'true';
process.env.EMAIL_PROVIDER = '';
