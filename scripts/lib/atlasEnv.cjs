/**
 * The Atlas connection string, read from the gitignored env file — in one place.
 *
 * WHY THIS FILE IS .cjs WHILE THE SCRIPTS BESIDE IT ARE NOT. Two callers need
 * this logic and they are written in different module systems:
 *
 *   scripts/atlas-stack.cjs      CommonJS  (require)
 *   scripts/approveExistingUsers.js  ESM   (package.json says "type": "module")
 *
 * A CommonJS file can be required by the first AND default-imported by the
 * second — Node has supported `import x from './x.cjs'` for years, and the
 * import gives back `module.exports`. The reverse is not true: a CommonJS file
 * cannot synchronously require an ESM one, so writing this as .js would have
 * forced atlas-stack.cjs into a dynamic `import()` and an async rewrite of its
 * top-level wiring. One .cjs file, no build step, no duplicated parser.
 *
 * THE VALUE THIS RETURNS IS A LIVE CREDENTIAL. Nothing here prints it, and no
 * error message built here contains it. Callers hand it to a child process
 * through `env` or to mongoose.connect — never to a command line, a log line or
 * an argv, all three of which are readable by other processes and end up in a
 * transcript.
 *
 * THESE FUNCTIONS THROW, THEY DO NOT EXIT. atlas-stack.cjs treats a missing file
 * as fatal; approveExistingUsers.js treats it as "fall through to the next
 * option". A shared helper that called process.exit would have taken that choice
 * away from the second caller.
 */
const fs = require('fs');
const path = require('path');

/** Named once so no caller has to spell it, and so a rename is a one-line change. */
const ATLAS_ENV_FILENAME = '.env.atlas';

/**
 * Absolute path to the env file at the repository root.
 * `__dirname` is scripts/lib, so the root is two levels up — not one, as it was
 * when this code lived directly in scripts/atlas-stack.cjs.
 */
const atlasEnvPath = () => path.join(__dirname, '..', '..', ATLAS_ENV_FILENAME);

/** True when the env file is present. Does not read it. */
const hasAtlasEnvFile = () => fs.existsSync(atlasEnvPath());

/**
 * MONGO_ATLAS_URI out of the env file.
 * Throws when the file is absent or the variable is missing from it. The thrown
 * message names the file and the variable and nothing else.
 */
const readAtlasUri = () => {
  const envPath = atlasEnvPath();
  if (!fs.existsSync(envPath)) {
    throw new Error(`${ATLAS_ENV_FILENAME} not found. Expected MONGO_ATLAS_URI there.`);
  }
  const m = fs.readFileSync(envPath, 'utf8').match(/MONGO_ATLAS_URI\s*=\s*(.+)/);
  if (!m) {
    throw new Error(`MONGO_ATLAS_URI missing from ${ATLAS_ENV_FILENAME}`);
  }
  return m[1].trim().replace(/^["']|["']$/g, '');
};

/** Force a specific database into the SRV URI (…mongodb.net/<db>?…). */
const withDatabase = (uri, dbName) => {
  const [base, query = ''] = uri.split('?');
  const host = base.replace(/\/+$/, '');
  return `${host}/${dbName}${query ? `?${query}` : ''}`;
};

module.exports = { ATLAS_ENV_FILENAME, atlasEnvPath, hasAtlasEnvFile, readAtlasUri, withDatabase };
