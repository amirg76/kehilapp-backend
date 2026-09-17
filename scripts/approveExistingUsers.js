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
 *   - refuses unless NODE_ENV names a KNOWN development environment;
 *   - refuses when the target database is not one of the demo databases;
 *   - DRY RUN by default. It reports exactly what it would change and exits 0
 *     without writing. Pass --yes to actually write.
 *   - only touches documents that were never given an approval decision. An
 *     account an admin already decided about — approved, or DELIBERATELY
 *     REVOKED — is never rewritten.
 *   - logs the count before and after, from the database, not from the update
 *     result — the point is to see the state, not to be told about it.
 *
 * RE-RUNNING. A second run changes nothing that the first run left behind, and
 * it never re-admits an account revoked in between. It is NOT a no-op in the
 * absolute sense: an account created between the two runs and still awaiting a
 * decision would be admitted by the second one. Run this once, at the deploy
 * that introduces `approved`, and not as a habit.
 *
 *   node scripts/approveExistingUsers.js          # dry run, changes nothing
 *   node scripts/approveExistingUsers.js --yes    # writes
 */
import mongoose from 'mongoose';

import { getMongoUri } from '../src/config/env.js';
import { isKnownNonProduction, nodeEnvName } from '../src/config/environment.js';
import User from '../src/apps/users/dataAccess/userModel.js';

/** Kept in step with scripts/seedDemo.js — see the rationale there. `kehilapp`, the
 *  real application database, is deliberately absent. */
const DEMO_DATABASES = ['kehilapp_demo', process.env.ATLAS_DEMO_DB].filter(Boolean);

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
  // DEFAULT-DENY — see the identical guard in scripts/seedDemo.js for why the
  // safe list is the one that decides.
  if (!isKnownNonProduction()) {
    console.error(
      `approveExistingUsers: refusing to run with NODE_ENV=${nodeEnvName()} — admitting every existing account to the community is a decision for a human, not a migration. Run it only with NODE_ENV set to one of: local, dev, development, test.`,
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
 * `revokedAt` is the right signal, per setUserApprovalInDb in
 * apps/users/dataAccess/userRepository.js: revoking sets revokedAt/revokedBy and
 * unsets approvedAt/approvedBy, approving does the exact reverse. So the trail is
 * present on precisely the accounts whose LAST decision was a revocation, and a
 * revoked account that is later re-approved loses it again. There is no such
 * thing as a revocation that predates the trail: `git log -S revokedAt` shows the
 * revoke capability and these two fields arriving in the same commit.
 */
const PENDING_FILTER = {
  $and: [{ $or: [{ approved: { $exists: false } }, { approved: false }] }, { revokedAt: { $exists: false } }],
};

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
