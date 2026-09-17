/**
 * Atlas-backed live stack.
 *
 * Same idea as live-stack.cjs, but points the backend at the real MongoDB Atlas
 * cluster instead of an in-memory server — so data (registrations, messages)
 * PERSISTS across restarts.
 *
 * Reads MONGO_ATLAS_URI from .env.atlas (gitignored, never committed) and forces
 * a dedicated demo database so the cluster's existing `test` database is left
 * untouched.
 *
 *   node scripts/atlas-stack.cjs           # seed + start
 *   node scripts/atlas-stack.cjs --no-seed # start only, keep existing data
 */
const path = require('path');
const { spawn } = require('child_process');

// readAtlasUri/withDatabase used to live here. They now live in scripts/lib so
// the maintenance scripts can resolve Atlas the same way instead of having the
// connection string handed to them on a command line. See that file for why it
// is CommonJS and why it throws rather than exiting.
const { readAtlasUri, withDatabase } = require('./lib/atlasEnv.cjs');

const DEMO_DB = process.env.ATLAS_DEMO_DB || 'kehilapp_demo';
const PORT = process.env.PORT || 5001;

/** Unchanged behaviour: for THIS script a missing env file is simply fatal. */
const resolveUri = () => {
  try {
    return withDatabase(readAtlasUri(), DEMO_DB);
  } catch (err) {
    // err.message names the file and the variable — never the URI.
    console.error(`[atlas-stack] ${err.message}`);
    return process.exit(1);
  }
};

const uri = resolveUri();

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: String(PORT),
  MONGO_URI: uri,
  JWT_SECRET: process.env.JWT_SECRET || 'atlas-demo-secret-not-for-production',
  BUCKET_NAME: process.env.BUCKET_NAME || 'demo-bucket',
  BUCKET_REGION: process.env.BUCKET_REGION || 'us-east-1',
  BUCKET_ACCESS_KEY: process.env.BUCKET_ACCESS_KEY || 'demo',
  BUCKET_SECRET_ACCESS_KEY: process.env.BUCKET_SECRET_ACCESS_KEY || 'demo',
  ALLOWED_ORIGINS:
    process.env.ALLOWED_ORIGINS ||
    // 5180 = resident app (dev), 4173 = its preview build,
    // 3001 = admin dashboard (dev), 4174 = admin preview build.
    // A credentialed cross-origin request from anywhere else is refused, so an
    // origin missing here shows up as the admin failing to log in at all.
    'http://localhost:5180,http://localhost:5173,http://localhost:4173,http://localhost:3001,http://localhost:4174',
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || 'lax',
};

const startServer = () => {
  // Never print the URI — it carries credentials.
  console.log(`\n[atlas-stack] database: ${DEMO_DB} (Atlas — data persists)`);
  console.log(`[atlas-stack] starting backend on http://localhost:${PORT} ...\n`);
  const server = spawn('node', ['src/index.js'], { env, stdio: 'inherit', cwd: path.join(__dirname, '..') });
  const bye = () => {
    server.kill();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
};

if (process.argv.includes('--no-seed')) {
  startServer();
} else {
  const seed = spawn('node', ['scripts/seedDemo.js'], {
    env,
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
  seed.on('exit', (code) => {
    if (code !== 0) {
      console.error('[atlas-stack] seed failed');
      process.exit(1);
    }
    startServer();
  });
}
