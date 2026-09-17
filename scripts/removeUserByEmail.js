/**
 * Maintenance: removes ONE named account, by email address.
 *
 * WHY THIS EXISTS. An account registered through the running public demo carries
 * a garbled name — the bytes that arrived are not the Hebrew that was typed — and
 * the users table in the admin dashboard renders it as noise. There is no
 * delete-user route in the API and there is not going to be one: deleting a
 * member is not a thing the product does, and an endpoint that can do it is an
 * endpoint that can be reached. So the capability lives here, in a script, where
 * it takes a person at a terminal who has the repository checked out.
 *
 * THIS SCRIPT HAS NO PRODUCTION DOOR, AND scripts/approveExistingUsers.js DOES.
 * Do not "harmonise" them — the asymmetry is the whole design:
 *
 *   approveExistingUsers.js is a MIGRATION. It exists FOR a real deployment: the
 *   deploy that introduces `approved` has to admit the accounts that predate the
 *   field, on the real board. A development-only guard there would not protect
 *   that deployment, it would only push the operator out of the reviewed code and
 *   into mongosh. So it has an explicit, narrow, loudly-typed door.
 *
 *   THIS script deletes a named person's account. There is no production use of
 *   that which is better served by a script than by a human being looking at the
 *   database with another human being watching: no correctness argument makes
 *   "delete this row" safer when it is automated, the operation is irreversible,
 *   and the thing it destroys is somebody's account rather than a flag on it. A
 *   door here would buy nothing and could only ever be opened by mistake. There
 *   is no flag, no environment variable and no argument that opens one.
 *
 * SAFETY, in the order the checks run:
 *   - --email is required. Nothing is guessed and nothing is matched by prefix.
 *   - refuses unless NODE_ENV names a KNOWN non-production environment
 *     (default-deny: 'staging' and an unset value are both refused);
 *   - refuses any database that is not a demo one, by the same `_demo` rule the
 *     other scripts use (scripts/lib/demoDatabase.js);
 *   - refuses unless EXACTLY ONE account matches. Zero means there is nothing to
 *     do and the operator has the wrong address; more than one means they are
 *     about to destroy something they did not mean to. Both exit non-zero.
 *   - DRY RUN by default: it prints the one document it matched and exits 0
 *     without writing. --yes performs the deletion.
 *   - counts are read back FROM THE DATABASE before and after, not taken from
 *     what deleteOne reported.
 *
 *   node scripts/removeUserByEmail.js --email someone@example.com
 *        # dry run — prints the match, deletes nothing
 *   node scripts/removeUserByEmail.js --email someone@example.com --yes
 *        # deletes it
 *
 * WHICH DATABASE. MONGO_URI if set; otherwise the gitignored Atlas env file, with
 * the demo database forced in. Same resolution as the migration — see
 * scripts/lib/mongoUri.js. A live connection string never goes on a command line.
 */
import mongoose from 'mongoose';

import { isKnownNonProduction, nodeEnvName } from '../src/config/environment.js';
import User from '../src/apps/users/dataAccess/userModel.js';
import { databaseNameOf, demoDatabases } from './lib/demoDatabase.js';
import { resolveMongoUri } from './lib/mongoUri.js';

const SCRIPT_NAME = 'removeUserByEmail';

const DEMO_DATABASES = demoDatabases({
  scriptName: SCRIPT_NAME,
  applicationDatabaseReason:
    'that is the real application database. This script deletes a member account, and unlike the approval migration it has no production mode at all — there is no flag that makes this acceptable and an environment variable is certainly not one.',
});

/** Resolved once; never printed. See the migration for the full order. */
let cachedUri;
const mongoUri = () => {
  if (cachedUri === undefined) {
    cachedUri = resolveMongoUri({
      scriptName: SCRIPT_NAME,
      // Validated by demoDatabases() above — a bad ATLAS_DEMO_DB has already exited.
      atlasDemoDatabase: DEMO_DATABASES[DEMO_DATABASES.length - 1],
    });
  }
  return cachedUri;
};

/**
 * The address to look for, normalised THE WAY THE MODEL STORES IT.
 *
 * userModel.js declares email with `lowercase: true, trim: true`, so every
 * address in the collection is already trimmed and lower-cased. Applying the same
 * two transforms to the argument turns "case-insensitive matching" into an ORDINARY
 * EQUALITY CHECK on a plain string — which is the point. The alternative, a
 * case-insensitive regex, would have been a filter built out of operator-supplied
 * text: `.` matches any character, and an address containing regex metacharacters
 * would match accounts that are not it. For a script whose job is to delete
 * exactly one row, a filter that can match more than what was typed is the one
 * thing it must not have.
 */
const requestedEmail = () => {
  const i = process.argv.indexOf('--email');
  const raw = i === -1 ? '' : process.argv[i + 1];
  const email = String(raw || '').trim().toLowerCase();
  if (!email || email.startsWith('--')) {
    console.error(
      `${SCRIPT_NAME}: --email <address> is required. Example:\n` +
        `  node scripts/removeUserByEmail.js --email someone@example.com        # dry run\n` +
        `  node scripts/removeUserByEmail.js --email someone@example.com --yes  # delete`,
    );
    return process.exit(1);
  }
  return email;
};

/**
 * Decides whether this run may proceed, and exits non-zero when it may not.
 *
 * Default-deny on the environment, as in scripts/seedDemo.js: the list that
 * matters is the SAFE one, because a guard that only recognises one dangerous
 * spelling ('production') is silent under `npm run prod`, under 'staging' and
 * under a typo. Never printed here: the URI, which carries credentials — only the
 * database name, which databaseNameOf() strips them out of.
 */
const authoriseTarget = () => {
  if (!isKnownNonProduction()) {
    console.error(
      `${SCRIPT_NAME}: refusing to run with NODE_ENV=${nodeEnvName()} — this script permanently deletes a member account, and it has no production mode. Run it only with NODE_ENV set to one of: local, dev, development, test.`,
    );
    process.exit(1);
  }

  const dbName = databaseNameOf(mongoUri());
  if (!DEMO_DATABASES.includes(dbName)) {
    console.error(
      `${SCRIPT_NAME}: refusing to touch database "${dbName || '(none named in MONGO_URI)'}" — only the demo databases [${DEMO_DATABASES.join(', ')}] may be edited by this script. Set ATLAS_DEMO_DB to a "_demo"-suffixed name if the demo database is named differently.`,
    );
    process.exit(1);
  }

  return dbName;
};

const run = async () => {
  // Before anything opens a connection: a refusal must cost nothing.
  const email = requestedEmail();
  const dbName = authoriseTarget();
  const apply = process.argv.includes('--yes');

  // Same reasoning as the other maintenance scripts: this runs against an
  // in-memory server that is still starting in tests, and against a remote Atlas
  // demo in real use. Giving up on a slow connection looks like a broken script.
  await mongoose.connect(mongoUri(), {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 60000,
  });
  console.log(`connected (database: ${dbName})`);

  const totalBefore = await User.countDocuments();
  const matches = await User.countDocuments({ email });
  console.log(`before: ${totalBefore} account(s), ${matches} matching ${email}`);

  // EXACTLY ONE, or nothing happens. Both failure directions are real: zero means
  // the operator has the wrong address and a "success" would tell them the account
  // is gone when it never existed; more than one (a unique index is not a
  // guarantee about a database somebody has been editing by hand) means a
  // deleteOne would silently pick one of them and deleteMany would take both.
  if (matches !== 1) {
    console.error(
      matches === 0
        ? `${SCRIPT_NAME}: no account matches ${email} — nothing to delete. Check the address; matching is exact, after trimming and lower-casing.`
        : `${SCRIPT_NAME}: ${matches} accounts match ${email} — refusing. This script deletes one named account or none at all.`,
    );
    await mongoose.connection.close();
    return process.exit(1);
  }

  // Only these four fields, deliberately. The rest of the document is nobody's
  // business here, and passwordHash / emailVerificationTokenHash are `select: false`
  // in the schema so they are not even fetched.
  const doc = await User.findOne({ email }).select('_id email role name').lean();

  console.log('matched:');
  console.log(`  _id:   ${doc._id}`);
  console.log(`  email: ${doc.email}`);
  console.log(`  role:  ${doc.role}`);
  // JSON-ESCAPED, ON PURPOSE. This account exists to be deleted BECAUSE its name
  // is garbled — the stored bytes are not the Hebrew that was typed. Printed raw,
  // a name like that can carry characters the terminal ACTS on instead of showing:
  // control codes, and bidirectional marks that visually reorder the rest of the
  // line — so the operator could read a different address than the one about to be
  // deleted. JSON.stringify escapes every control character to a visible \uXXXX,
  // and wraps the whole thing in quotes on a single line, so the boundaries of the
  // value are unambiguous even where a character still renders. It is one call and
  // it removes the whole class of problem; the operator's decision rests on the
  // _id and the email above, which are ASCII.
  console.log(`  name:  ${JSON.stringify(doc.name)}`);

  if (!apply) {
    console.log('\nDRY RUN — nothing was deleted. Re-run with --yes to apply.');
    await mongoose.connection.close();
    return undefined;
  }

  await User.deleteOne({ _id: doc._id });

  // Re-counted FROM THE DATABASE. deleteOne's own report is the script's opinion
  // of what happened; these two numbers are what is actually there.
  const totalAfter = await User.countDocuments();
  const matchesAfter = await User.countDocuments({ email });
  console.log(`after: ${totalAfter} account(s), ${matchesAfter} matching ${email}`);

  if (matchesAfter !== 0 || totalAfter !== totalBefore - 1) {
    console.error(
      `${SCRIPT_NAME}: the database does not look the way a single deletion should have left it (was ${totalBefore}, is ${totalAfter}, still matching: ${matchesAfter}).`,
    );
    await mongoose.connection.close();
    return process.exit(1);
  }

  console.log(`deleted 1 account (${email}).`);
  await mongoose.connection.close();
  return undefined;
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.connection.close();
  process.exit(1);
});
