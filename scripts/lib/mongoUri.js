/**
 * Which database a maintenance script talks to, and where that answer comes from.
 *
 * THE PROBLEM THIS SOLVES. Both maintenance scripts used to resolve their target
 * from `getMongoUri()` alone, i.e. from MONGO_URI. Against the Atlas demo that
 * left the operator one option: put the live connection string on a command line.
 * A command line is readable in the shell history, in the process list and in any
 * transcript of the session — this project has already lost credentials that way.
 * scripts/atlas-stack.cjs never had that problem, because it reads the URI out of
 * the gitignored env file itself. This gives the scripts the same ability, using
 * the same code (scripts/lib/atlasEnv.cjs), not a copy of it.
 *
 * THE RESOLUTION ORDER, and it is deliberate:
 *
 *   1. MONGO_URI from the environment, if it is set. This is what the tests use
 *      and what a local mongod run uses, and it keeps working EXACTLY as before —
 *      when MONGO_URI is set, nothing below this line executes and no file is
 *      even looked at.
 *   2. Otherwise, if the Atlas env file is present: read MONGO_ATLAS_URI out of it
 *      and force the demo database into the SRV URI, the same way
 *      scripts/atlas-stack.cjs does, so the script lands on the same database the
 *      demo stack serves and never on whatever database the cluster defaults to.
 *   3. Otherwise, fail — naming BOTH options, because an operator who gets here
 *      has no way to guess which of the two this script wanted.
 *
 * THE URI IS NEVER PRINTED. It carries credentials. Every message below names the
 * variable, the file or the database — never the value. The callers print the
 * database NAME only, which they derive with databaseNameOf().
 */
import { getMongoUri } from '../../src/config/env.js';
import atlasEnv from './atlasEnv.cjs';

const { ATLAS_ENV_FILENAME, hasAtlasEnvFile, readAtlasUri, withDatabase } = atlasEnv;

/**
 * Resolves the connection string, or exits non-zero having said why.
 *
 * `scriptName` prefixes the failure so the operator knows which of several
 * scripts refused. `atlasDemoDatabase` is the database name to force into the
 * Atlas URI — the caller passes its own VALIDATED demo-database name, so the
 * `_demo` suffix rule is enforced before we ever get here.
 */
export const resolveMongoUri = ({ scriptName, atlasDemoDatabase }) => {
  // 1. The environment wins. Unchanged behaviour for every existing caller.
  if (process.env.MONGO_URI) return getMongoUri();

  // 2. The Atlas env file, read in-process so the value never reaches an argv.
  if (hasAtlasEnvFile()) {
    try {
      return withDatabase(readAtlasUri(), atlasDemoDatabase);
    } catch (err) {
      // err.message names the file and the missing variable, never the URI.
      console.error(`${scriptName}: ${err.message}`);
      return process.exit(1);
    }
  }

  // 3. Neither. Name both ways out.
  console.error(
    `${scriptName}: no database to connect to. Either set MONGO_URI in the environment, ` +
      `or create ${ATLAS_ENV_FILENAME} at the repository root with MONGO_ATLAS_URI=<connection string> ` +
      `(gitignored — the same file scripts/atlas-stack.cjs reads). ` +
      `Do not pass the connection string on the command line.`,
  );
  return process.exit(1);
};
