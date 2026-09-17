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
 * SAFETY, same shape as scripts/seedDemo.js:
 *   - refuses when NODE_ENV === 'production';
 *   - refuses when the target database is not one of the demo databases;
 *   - DRY RUN by default. It reports exactly what it would change and exits 0
 *     without writing. Pass --yes to actually write.
 *   - only touches documents where `approved` is missing or false. An account
 *     that is already approved is never rewritten, so re-running is a no-op.
 *   - logs the count before and after, from the database, not from the update
 *     result — the point is to see the state, not to be told about it.
 *
 *   node scripts/approveExistingUsers.js          # dry run, changes nothing
 *   node scripts/approveExistingUsers.js --yes    # writes
 */
import mongoose from 'mongoose';

import { getMongoUri } from '../src/config/env.js';
import User from '../src/apps/users/dataAccess/userModel.js';

/** Kept in step with scripts/seedDemo.js — see the rationale there. */
const DEMO_DATABASES = ['kehilapp', 'kehilapp_demo', process.env.ATLAS_DEMO_DB].filter(Boolean);

/**
 * The database a Mongo connection string resolves to, or '' when it names none.
 * Credentials are stripped before anything is read, so nothing secret can reach
 * a log line built from this value.
 */
const databaseNameOf = (uri) => {
  const [authority] = String(uri)
    .replace(/^mongodb(\+srv)?:\/\//i, '')
    .split('?');
  const afterCredentials = authority.slice(authority.lastIndexOf('@') + 1);
  const slash = afterCredentials.indexOf('/');
  if (slash === -1) return '';
  try {
    return decodeURIComponent(afterCredentials.slice(slash + 1));
  } catch {
    return afterCredentials.slice(slash + 1);
  }
};

/** Exits non-zero unless this is demonstrably a demo target. */
const refuseNonDemoTarget = () => {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'approveExistingUsers: refusing to run with NODE_ENV=production — admitting every existing account to the community is a decision for a human, not a migration.',
    );
    process.exit(1);
  }

  // Never printed: the URI itself, which carries credentials.
  const dbName = databaseNameOf(getMongoUri());
  if (!DEMO_DATABASES.includes(dbName)) {
    console.error(
      `approveExistingUsers: refusing to touch database "${dbName || '(none named in MONGO_URI)'}" — only the demo databases [${DEMO_DATABASES.join(', ')}] may be migrated. Set ATLAS_DEMO_DB if the demo database is named differently.`,
    );
    process.exit(1);
  }
};

// Missing OR false. `{ approved: false }` alone would skip every document written
// before the field existed, which is precisely the set this migration is for.
const PENDING_FILTER = { $or: [{ approved: { $exists: false } }, { approved: false }] };

const run = async () => {
  // Before anything opens a connection: a refusal must cost nothing.
  refuseNonDemoTarget();

  const apply = process.argv.includes('--yes');

  await mongoose.connect(getMongoUri());
  console.log(`connected (database: ${databaseNameOf(getMongoUri())})`);

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

  const result = await User.updateMany(PENDING_FILTER, {
    $set: { approved: true, approvedAt: new Date(), approvedBy: 'migration:approveExistingUsers' },
    // Keep the two audit states coherent, exactly as the repository does: an
    // account carrying a revocation trail must not also read as approved.
    $unset: { revokedAt: '', revokedBy: '' },
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
