/**
 * The demo seed must not ship a password anybody can read off the repository.
 *
 * WHY THIS FILE REPLACES A GREP. The previous version of this check read
 * scripts/seedDemo.js as TEXT and looked for password-shaped literals. A
 * reviewer defeated it in one move: a hardcoded password under a neutral
 * variable name matched none of the patterns and passed every assertion, lint
 * clean. A regex can only ever recognise the disguises somebody already thought
 * of.
 *
 * So the test stops reading the file and starts running it. "Generated, not
 * hardcoded" has an observable meaning: RUN THE SEED TWICE AND THE TWO RUNS MUST
 * ISSUE DIFFERENT PASSWORDS. A constant — however it is spelled, wherever it is
 * hidden, however it is assembled at run time — fails that, because a constant is
 * the same twice.
 *
 * Both runs go against a throwaway database on the in-memory server jest already
 * has, under the demo name the seed's own allowlist accepts. Nothing here touches
 * the `test` database the rest of the suite uses.
 *
 * WHAT THIS CANNOT CATCH — stated plainly, because a gate that oversells itself
 * is worse than none:
 *   - a password that is random per run but WEAK (four digits would pass).
 *   - a credential that is not an account password: an API key, a JWT secret, a
 *     bucket key. This test only observes what the seed prints for the accounts
 *     it creates. scripts/live-stack.cjs's JWT_SECRET, for example, is outside it.
 *   - a secret in any other file, or in git history. Those are a secret scan's
 *     job, not a unit test's.
 *   - a password written into the file AND also randomised per run — the literal
 *     would still be published even though this test is green. The two surviving
 *     source checks below exist for that residue, and are no longer the only
 *     thing between the repository and a committed credential.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

const repoRoot = process.cwd();
const seedPath = path.join('scripts', 'seedDemo.js');

const DEMO_DB = 'kehilapp_demo_passwords';

let demoUri;

beforeAll(() => {
  // Same host and port as the suite's memory server, a database of its own.
  const { host, port } = mongoose.connection;
  demoUri = `mongodb://${host}:${port}/${DEMO_DB}`;
});

const runSeed = (env = {}) => {
  const result = spawnSync(process.execPath, [seedPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // The seed's allowlist is matched on the database NAME, so the throwaway
      // database above is declared as the demo database for these runs.
      ATLAS_DEMO_DB: DEMO_DB,
      MONGO_URI: demoUri,
      // Deliberately cleared: the point of the first tests is the NO-ENV path.
      DEMO_PASSWORD: '',
      DEMO_ADMIN_PASSWORD: '',
      DEMO_MEMBER_PASSWORD: '',
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
};

/**
 * The credentials the seed printed, as { email: password }.
 *
 * Parsed from the run's own stdout — the seed prints one line per account:
 *   `  admin  admin@demo.example.com  <password>   (generated for this run)`
 */
const credentialsFrom = (stdout) =>
  Object.fromEntries(
    stdout
      .split('\n')
      .map((line) => line.match(/^\s+(?:admin|member)\s+(\S+@\S+)\s+(\S+)\s+\((.+)\)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], { password: m[2], source: m[3] }]),
  );

describe('scripts/seedDemo.js generates its passwords instead of carrying them', () => {
  jest.setTimeout(180000);

  it('issues DIFFERENT passwords on two consecutive runs', () => {
    const first = runSeed();
    expect(first.status).toBe(0);

    const second = runSeed();
    expect(second.status).toBe(0);

    const a = credentialsFrom(first.stdout);
    const b = credentialsFrom(second.stdout);

    // The parse must have worked, or the rest of this proves nothing.
    const emails = Object.keys(a);
    expect(emails.sort()).toEqual(['admin@demo.example.com', 'member@demo.example.com']);
    expect(Object.keys(b).sort()).toEqual(emails);

    emails.forEach((email) => {
      expect(a[email].source).toBe('generated for this run');
      // THE ASSERTION. A constant is the same twice; this is not.
      expect(b[email].password).not.toBe(a[email].password);
      // And not trivially short, so a four-character "random" default is not
      // quietly accepted either.
      expect(a[email].password.length).toBeGreaterThanOrEqual(16);
    });

    // The two accounts do not even share a password with each other.
    expect(a['admin@demo.example.com'].password).not.toBe(a['member@demo.example.com'].password);
  });

  it('uses the password the environment provides, when it provides one', () => {
    const chosen = `env-chosen-${Date.now()}-abcdefgh`;
    const { status, stdout } = runSeed({ DEMO_PASSWORD: chosen });

    expect(status).toBe(0);

    const creds = credentialsFrom(stdout);
    expect(creds['admin@demo.example.com'].password).toBe(chosen);
    expect(creds['member@demo.example.com'].password).toBe(chosen);
    expect(creds['admin@demo.example.com'].source).toBe('from env');
  });

  it('lets the per-role variables override the shared one', () => {
    const shared = `shared-${Date.now()}-aaaaaaaa`;
    const adminOnly = `admin-${Date.now()}-bbbbbbbb`;
    const { status, stdout } = runSeed({ DEMO_PASSWORD: shared, DEMO_ADMIN_PASSWORD: adminOnly });

    expect(status).toBe(0);
    const creds = credentialsFrom(stdout);
    expect(creds['admin@demo.example.com'].password).toBe(adminOnly);
    expect(creds['member@demo.example.com'].password).toBe(shared);
  });
});

describe('scripts/seedDemo.js source: the residue a behavioural test cannot see', () => {
  // These two survive the regex cull. They are NOT the gate — the runs above are.
  // They catch the one thing running the script cannot: a literal sitting in the
  // file, published with the repository and kept in its history, even while the
  // code path that runs takes a generated value instead.
  const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'seedDemo.js'), 'utf8');

  it('never falls back to a literal when the password variable is absent', () => {
    // `process.env.X_PASSWORD || 'something'` — a default that reads as harmless
    // and publishes a credential.
    const envFallbackToLiteral = source.match(/process\.env\.[A-Z_]*PASSWORD[A-Z_]*\s*\|\|\s*['"`]/gi) || [];
    expect(envFallbackToLiteral).toEqual([]);
  });

  it('no longer pairs the retired admin address with anything', () => {
    // The account was removed; only the comment explaining why may name it, and
    // never next to a credential.
    const lines = source.split('\n').filter((line) => line.includes('admin@weunity.com'));
    lines.forEach((line) => expect(line.trim().startsWith('//')).toBe(true));
  });
});
