/**
 * Live-stack harness for manual/local verification.
 *
 * Boots a real MongoDB (via mongodb-memory-server), seeds demo data, and starts
 * the actual backend process against it. Prints the base URL and demo creds, then
 * stays up until Ctrl-C. Used to verify the cookie/CSRF flow end-to-end against a
 * running server rather than only in-process tests.
 *
 *   node scripts/live-stack.cjs
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');

(async () => {
  const mongod = await MongoMemoryServer.create();
  // `kehilapp_demo`, not `kehilapp`. This throwaway server holds demo data only,
  // and `kehilapp` is the name of the REAL application database
  // (docs/05-running-locally.md) — scripts/seedDemo.js no longer accepts it, on
  // purpose. Rename this and the seed refuses to run; that is the guard working.
  const uri = mongod.getUri('kehilapp_demo');
  const PORT = process.env.PORT || 5001;

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    MONGO_URI: uri,
    JWT_SECRET: 'live-stack-secret-not-for-production',
    BUCKET_NAME: 'demo-bucket',
    BUCKET_REGION: 'us-east-1',
    BUCKET_ACCESS_KEY: 'demo',
    BUCKET_SECRET_ACCESS_KEY: 'demo',
    // Keep in step with atlas-stack.cjs: 5180/4173 resident app, 3001/4174 admin.
    ALLOWED_ORIGINS:
      process.env.ALLOWED_ORIGINS ||
      'http://localhost:5180,http://localhost:5173,http://localhost:4173,http://localhost:3001,http://localhost:4174',
  };

  // Seed, then start the server.
  const seed = spawn('node', ['scripts/seedDemo.js'], { env, stdio: 'inherit' });
  seed.on('exit', (code) => {
    if (code !== 0) { console.error('seed failed'); process.exit(1); }
    console.log(`\n[live-stack] mongo: ${uri}`);
    console.log(`[live-stack] starting backend on http://localhost:${PORT} ...\n`);
    const server = spawn('node', ['src/index.js'], { env, stdio: 'inherit' });
    const bye = async () => { server.kill(); await mongod.stop(); process.exit(0); };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  });
})();
