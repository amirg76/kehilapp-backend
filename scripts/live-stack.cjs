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
  // storageEngine mirrors jest.mongo.setup.js, and for the same reason: this
  // project pins mongodb-memory-server to a MongoDB build (package.json ->
  // config.mongodbMemoryServer) from which `ephemeralForTest` — the library's
  // own default — has been removed. The jest setup was given this override when
  // the version was pinned; this script was not, so `node scripts/live-stack.cjs`
  // has since died on startup with "unknown storage engine: ephemeralForTest"
  // while the whole test suite stayed green. Measured here on 18.9.2026: it
  // failed before this line was added and started after.
  const mongod = await MongoMemoryServer.create({
    instance: {
      storageEngine: 'wiredTiger',
      // Carried across with storageEngine rather than left behind. jest.mongo
      // .setup.js documents BOTH overrides — the engine and this timeout, which
      // exists because the library's 10s default failed on this machine — and
      // copying only the first would repeat the drift that broke this script in
      // the first place: one file got the fix, its neighbour did not.
      launchTimeout: 120000,
    },
  });
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
    // Registration on a throwaway stack has to be completable without a mailbox,
    // so the verification link comes back in the response here. The server refuses
    // this flag outside a development environment; see config/environment.js.
    //
    // Tested against `undefined`, not falsy: `EXPOSE_VERIFICATION_LINK= node
    // scripts/live-stack.cjs` is how you watch the closed-gate behaviour locally,
    // and `||` would have quietly turned that back on.
    EXPOSE_VERIFICATION_LINK:
      process.env.EXPOSE_VERIFICATION_LINK === undefined ? 'true' : process.env.EXPOSE_VERIFICATION_LINK,
    // APP_BASE_URL is deliberately NOT set here. It is the resident app's origin,
    // the mailer already defaults it to :5180 for development, and pinning it in
    // this script would override the .env of anyone pointing a local server at a
    // deployed front end.
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
