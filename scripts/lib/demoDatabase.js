/**
 * Which databases a maintenance script may touch, and how it works that out.
 *
 * The rule and its history are written out in full in scripts/seedDemo.js — read
 * that comment, it is the one that explains why `kehilapp` must never return to
 * the allowlist and why the discriminator is a `_demo` SUFFIX rather than a
 * blocklist. This file is the mechanism, shared by the scripts that enforce it,
 * so that fixing the rule once fixes it everywhere.
 *
 * (scripts/seedDemo.js still carries its own copy. It is deliberately left alone
 * here: it is not part of this change, its refusal messages are pinned by its own
 * tests, and the right time to fold it in is when someone is already editing it.)
 */

/** The real application board. Never a demo target, under any spelling of any flag. */
export const APPLICATION_DATABASE = 'kehilapp';

/** What a database has to be named before a script will write to it. */
export const DEMO_SUFFIX = '_demo';

/** The one demo database every stack script pins by default. */
export const DEFAULT_DEMO_DATABASE = 'kehilapp_demo';

/**
 * The database a Mongo connection string resolves to, or '' when it names none.
 * Credentials are stripped before anything is read, so nothing secret can reach
 * a log line built from this value.
 */
export const databaseNameOf = (uri) => {
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

/**
 * ATLAS_DEMO_DB, but only if it actually names a demo database — otherwise the
 * process is refused, not the value silently dropped.
 *
 * An unchecked ATLAS_DEMO_DB was how the real board got back onto the allowlist
 * that was supposed to protect it: one environment variable undid the whole
 * guard. The value is validated here instead of trusted.
 *
 * `applicationDatabaseReason` lets each script say, in its own words, why an
 * environment variable is not how IT gets pointed at the real board — the
 * migration has a production door to point at instead, and the deletion script
 * has none.
 */
export const validatedAtlasDemoDatabase = ({ scriptName, applicationDatabaseReason }) => {
  const raw = (process.env.ATLAS_DEMO_DB || '').trim();
  if (!raw) return '';
  if (raw === APPLICATION_DATABASE) {
    console.error(`${scriptName}: refusing ATLAS_DEMO_DB="${raw}" — ${applicationDatabaseReason}`);
    process.exit(1);
  }
  if (!raw.endsWith(DEMO_SUFFIX)) {
    console.error(
      `${scriptName}: refusing ATLAS_DEMO_DB="${raw}" — a demo database must be named as one, ending in "${DEMO_SUFFIX}".`,
    );
    process.exit(1);
  }
  return raw;
};

/** The full allowlist: the pinned demo database, plus a validated ATLAS_DEMO_DB. */
export const demoDatabases = (options) => [DEFAULT_DEMO_DATABASE, validatedAtlasDemoDatabase(options)].filter(Boolean);
