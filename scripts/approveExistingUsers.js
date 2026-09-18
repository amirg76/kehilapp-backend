/**
 * One-off migration: admits the accounts that already existed.
 *
 * WHY THIS EXISTS. `approved` was added to the user schema with `default: false`,
 * and the schema default applies to documents written before the field existed
 * too — they hydrate as unapproved. That is the right default for a NEW account
 * and the wrong one for an account that has been using the board for months: the
 * moment the approval work deploys, every existing member silently drops to
 * public-only content and cannot write. This script admits them once, so the
 * gate starts closed only for people who arrive after it.
 *
 * SAFETY:
 *   - DRY RUN by default. It reports exactly what it would change and exits 0
 *     without writing. Pass --yes to actually write.
 *   - in a development environment, refuses any database that is not a demo one;
 *   - against PRODUCTION, refuses unless the operator names production out loud
 *     (see THE PRODUCTION DOOR below);
 *   - refuses outright on a NODE_ENV it does not recognise, either way;
 *   - only touches documents that were never given an approval decision. An
 *     account an admin already decided about — approved, or DELIBERATELY
 *     REVOKED — is never rewritten.
 *   - logs the count before and after, from the database, not from the update
 *     result — the point is to see the state, not to be told about it.
 *
 * THE PRODUCTION DOOR, AND WHY THIS SCRIPT HAS ONE AND scripts/seedDemo.js MUST
 * NOT. Do not "harmonise" the two guards. They are deliberately asymmetric:
 *
 *   seedDemo.js DELETES every category and message it finds and replaces them
 *   with invented content. It has no legitimate production use whatsoever, so its
 *   refusal is absolute and has no override.
 *
 *   THIS script exists FOR a real deployment — it is the migration that runs at
 *   the deploy which introduces `approved`, against the board that has the
 *   pre-existing accounts on it. A development-only guard does not protect that
 *   deployment; it just locks the operator out of the reviewed code. The two ways
 *   left were both worse than the script: point ATLAS_DEMO_DB at the real
 *   database, or run updateMany by hand in mongosh — without the revocation
 *   exclusion, re-admitting everyone an admin had deliberately revoked. A guard
 *   that forces the operator outside the reviewed code has made things less safe,
 *   not more.
 *
 * So the door is explicit, narrow, and impossible to open by accident:
 *
 *   node scripts/approveExistingUsers.js --i-understand-this-is-production
 *        # production DRY RUN — prints the database and the exact change, writes nothing
 *   node scripts/approveExistingUsers.js --i-understand-this-is-production --yes
 *        # production WRITE
 *
 * Both flags are required to write. `--yes` alone still refuses in production,
 * and the long flag alone is still a dry run.
 *
 * WHICH DATABASE. MONGO_URI if it is set; otherwise, if the gitignored Atlas env
 * file is present at the repository root, the URI is read out of it in-process and
 * the demo database is forced in — exactly as scripts/atlas-stack.cjs does, and
 * with the same code. The operator therefore never puts a live connection string
 * on a command line, where the shell history and the process list would keep it.
 * The full order is on mongoUri() below.
 *
 * RE-RUNNING. A second run changes nothing that the first run left behind, and
 * it never re-admits an account revoked in between. It is NOT a no-op in the
 * absolute sense: an account created between the two runs and still awaiting a
 * decision would be admitted by the second one. Run this once, at the deploy
 * that introduces `approved`, and not as a habit.
 *
 *   node scripts/approveExistingUsers.js          # dry run, changes nothing
 *   node scripts/approveExistingUsers.js --yes    # writes (development/demo only)
 */
import mongoose from 'mongoose';

import { isKnownNonProduction, isProduction, nodeEnvName } from '../src/config/environment.js';
import User from '../src/apps/users/dataAccess/userModel.js';
import { databaseNameOf, demoDatabases, DEMO_SUFFIX } from './lib/demoDatabase.js';
import { resolveMongoUri } from './lib/mongoUri.js';

/**
 * The flag that opens the production door. Kept as a sentence on purpose: there
 * is no short form, no single-letter alias and no abbreviation, it appears in no
 * documented copy-paste command line, and no other flag implies it. It has to be
 * typed out, which is the entire mechanism — the operator states in writing what
 * they are about to do, to a machine that will then print it back to them.
 */
const PRODUCTION_FLAG = '--i-understand-this-is-production';

/** Kept in step with scripts/seedDemo.js — see the rationale there. `kehilapp`, the
 *  real application database, is deliberately absent, and ATLAS_DEMO_DB is
 *  validated rather than trusted (an unchecked value put the board back on this
 *  list). The rule itself now lives in scripts/lib/demoDatabase.js so this script
 *  and scripts/removeUserByEmail.js enforce one copy of it. */
const SCRIPT_NAME = 'approveExistingUsers';

const DEMO_DATABASES = demoDatabases({
  scriptName: SCRIPT_NAME,
  applicationDatabaseReason: `that is the real application database, and an environment variable is not how this script is pointed at it. Use ${PRODUCTION_FLAG} instead, which says so out loud and prints what it will do.`,
});

/**
 * WHERE THE CONNECTION STRING COMES FROM — the order, spelled out, because the
 * whole point is that an operator never has to type a live URI into a terminal:
 *
 *   1. MONGO_URI from the environment, if set. This is what the tests use and it
 *      behaves exactly as it always did; when it is set nothing else is consulted.
 *   2. Otherwise, if the Atlas env file is present at the repository root, the URI
 *      is read out of it in-process and the DEMO database is forced into it — the
 *      same file and the same two functions scripts/atlas-stack.cjs uses.
 *   3. Otherwise the script fails, naming both options.
 *
 * Resolved once and reused: step 2 touches the filesystem, and re-reading it per
 * call would be three reads of a secret file for no reason. The value is never
 * printed anywhere below — only databaseNameOf() of it, which strips credentials.
 */
let cachedUri;
const mongoUri = () => {
  if (cachedUri === undefined) {
    cachedUri = resolveMongoUri({
      scriptName: SCRIPT_NAME,
      // Already validated by demoDatabases() above: an ATLAS_DEMO_DB that is not
      // named as a demo database has exited the process before this runs.
      atlasDemoDatabase: DEMO_DATABASES[DEMO_DATABASES.length - 1],
    });
  }
  return cachedUri;
};

/**
 * Decides whether this run may proceed, and exits non-zero when it may not.
 *
 * Three outcomes, and the unrecognised environment is refused in both branches —
 * default-deny, as in scripts/seedDemo.js. Never printed anywhere below: the URI
 * itself, which carries credentials. Only the database name.
 */
const authoriseTarget = () => {
  const dbName = databaseNameOf(mongoUri());
  const named = dbName || '(none named in MONGO_URI)';
  const acknowledged = process.argv.includes(PRODUCTION_FLAG);

  if (isKnownNonProduction()) {
    if (!DEMO_DATABASES.includes(dbName)) {
      console.error(
        `approveExistingUsers: refusing to touch database "${named}" — in a development environment only the demo databases [${DEMO_DATABASES.join(', ')}] may be migrated. Set ATLAS_DEMO_DB to a "${DEMO_SUFFIX}"-suffixed name if the demo database is named differently, or run the real migration with ${PRODUCTION_FLAG}.`,
      );
      process.exit(1);
    }
    return { dbName: named, production: false };
  }

  if (isProduction()) {
    if (!acknowledged) {
      console.error(
        `approveExistingUsers: refusing to run against production (NODE_ENV=${nodeEnvName()}) without ${PRODUCTION_FLAG}.\n` +
          `This migration is FOR a real deployment — see the header of this file — so the door exists. It is just not open by default.\n` +
          `  dry run: node scripts/approveExistingUsers.js ${PRODUCTION_FLAG}\n` +
          `  write:   node scripts/approveExistingUsers.js ${PRODUCTION_FLAG} --yes`,
      );
      process.exit(1);
    }
    return { dbName: named, production: true };
  }

  console.error(
    `approveExistingUsers: refusing to run with NODE_ENV=${nodeEnvName()} — that is neither a known development environment nor a known production one, and this script will not guess which. Set NODE_ENV to one of: local, dev, development, test, prod, production.`,
  );
  return process.exit(1);
};

/**
 * The accounts this migration is for: never given an approval decision at all.
 *
 * Two conditions, and both are load-bearing.
 *
 * `approved` missing OR false — `{ approved: false }` alone would skip every
 * document written before the field existed, which is precisely the set this
 * migration is for.
 *
 * AND no revocation trail. `approved: false` is true of two completely different
 * people: someone who predates the field, and someone an admin deliberately
 * REVOKED. Admitting the second is not a migration, it is undoing a human
 * decision — and the `$unset` this script performs would have destroyed the
 * evidence that the decision was ever made.
 *
 * revokedAt AND revokedBy are BOTH checked, per setUserApprovalInDb in
 * apps/users/dataAccess/userRepository.js: revoking sets revokedAt/revokedBy and
 * unsets approvedAt/approvedBy, approving does the exact reverse. So the trail is
 * present on precisely the accounts whose LAST decision was a revocation, and a
 * revoked account that is later re-approved loses it again. There is no such
 * thing as a revocation that predates the trail: `git log -S revokedAt` shows the
 * revoke capability and these two fields arriving in the same commit.
 *
 * Checking `revokedAt` alone was half a filter. The two fields are written
 * together and cleared together, but nothing in the schema enforces that, and a
 * document carrying revokedBy without revokedAt — a partial write, a hand-edit in
 * mongosh, a future code path — would be approved here while KEEPING its stale
 * revokedBy. apps/users/entryPoints/usersController.js then serves that field to
 * the UI, so the result is an approved account displaying the admin who revoked
 * it. Absence of a revocation trail means absence of BOTH halves of it.
 */
const PENDING_FILTER = {
  $and: [
    { $or: [{ approved: { $exists: false } }, { approved: false }] },
    { revokedAt: { $exists: false } },
    { revokedBy: { $exists: false } },
  ],
};

const run = async () => {
  // Before anything opens a connection: a refusal must cost nothing.
  const target = authoriseTarget();

  const apply = process.argv.includes('--yes');

  if (target.production) {
    // Say it out loud, before connecting, in the operator's own terminal: which
    // database, and which of the two things is about to happen to it.
    console.log('──────────────────────────────────────────────────────────────');
    console.log(`PRODUCTION RUN (NODE_ENV=${nodeEnvName()})`);
    console.log(`  database: ${target.dbName}`);
    console.log('  change:   set approved=true on every account that has never been');
    console.log('            given an approval decision (no revocation trail).');
    console.log(`  mode:     ${apply ? 'WRITE — this will modify the database' : 'DRY RUN — nothing will be written'}`);
    console.log('──────────────────────────────────────────────────────────────');
  }

  // Same reasoning as the seed script: this runs against a starting in-memory
  // server in tests and a remote Atlas database in the deployment it exists
  // for. A migration that gives up on a slow connection looks like a migration
  // that failed, and an operator who sees that will reach for mongosh instead.
  await mongoose.connect(mongoUri(), {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 60000,
  });
  // The NAME only. The URI carries credentials and is never logged.
  console.log(`connected (database: ${databaseNameOf(mongoUri())})`);

  const total = await User.countDocuments();
  const before = await User.countDocuments(PENDING_FILTER);
  console.log(`before: ${before} unapproved of ${total} account(s)`);

  if (!apply) {
    // Dry run. Name the accounts so the operator can check the list is the one
    // they expect before handing over the --yes.
    const sample = await User.find(PENDING_FILTER).select('email role').limit(20).lean();
    sample.forEach((u) => console.log(`  would approve: ${u.email} (${u.role})`));
    if (before > sample.length) console.log(`  ...and ${before - sample.length} more`);

    console.log('\nDRY RUN — nothing was written. Re-run with --yes to apply.');
    await mongoose.connection.close();
    return;
  }

  // No $unset of revokedAt/revokedBy. The repository clears them when an ADMIN
  // approves, because that admin has just overruled the revocation. This script
  // overrules nobody — PENDING_FILTER excludes every account that carries a
  // revocation trail, so there is none here to clear, and reaching for $unset
  // anyway would only mean quietly erasing an audit record if the filter ever
  // regressed.
  const result = await User.updateMany(PENDING_FILTER, {
    $set: { approved: true, approvedAt: new Date(), approvedBy: 'migration:approveExistingUsers' },
  });
  console.log(`modified: ${result.modifiedCount}`);

  // Re-counted from the database, not inferred from the result above.
  const after = await User.countDocuments(PENDING_FILTER);
  console.log(`after: ${after} unapproved of ${await User.countDocuments()} account(s)`);

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.connection.close();
  process.exit(1);
});
