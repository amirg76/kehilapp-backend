/**
 * The demo seed must not be able to run against production.
 *
 * scripts/seedDemo.js deletes every category and message it finds and replaces
 * them with invented demo content. Pointed at a real database that is not
 * recoverable by re-running anything, so the script refuses two ways:
 *
 *   1. NODE_ENV === 'production' — refuse outright, before anything connects.
 *   2. the MONGO_URI names a database that is not one of the demo databases.
 *
 * These tests run the real script as a child process, because the exit CODE is
 * the contract: scripts/live-stack.cjs and scripts/atlas-stack.cjs both spawn the
 * seed and abort when it exits non-zero.
 *
 * The third test is the other half — the guard must not break the two workflows
 * that legitimately seed. It pins the database names those two scripts choose
 * against the allowlist in the seed, so renaming one without the other fails here
 * rather than at 2am in front of a demo.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const seedPath = path.join('scripts', 'seedDemo.js');

const readScript = (name) => fs.readFileSync(path.join(repoRoot, 'scripts', name), 'utf8');

/** Runs the seed with a controlled environment and returns { status, stderr }. */
const runSeed = (env) => {
  const result = spawnSync(process.execPath, [seedPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
  return { status: result.status, stderr: result.stderr || '', stdout: result.stdout || '' };
};

describe('scripts/seedDemo.js refuses anything that is not a demo target', () => {
  // Spawning node twice; the default 5s timeout is not enough on a cold cache.
  jest.setTimeout(60000);

  it('exits non-zero with NODE_ENV=production, before it connects to anything', () => {
    // A reachable, demo-named URI: the ONLY thing that may stop this run is the
    // production check itself.
    const { status, stderr, stdout } = runSeed({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://127.0.0.1:27017/kehilapp',
    });

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/production/i);
    expect(stdout).not.toMatch(/connected/); // it never got as far as a connection
  });

  it('exits non-zero when the MONGO_URI names a database that is not a demo one', () => {
    const { status, stderr, stdout } = runSeed({
      NODE_ENV: 'development',
      MONGO_URI: 'mongodb+srv://user:pass@cluster0.example.mongodb.net/kehilapp_live?retryWrites=true',
    });

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/kehilapp_live/);
    expect(stdout).not.toMatch(/connected/);
    // The refusal must not echo the credentials it was handed.
    expect(stderr).not.toMatch(/pass@/);
  });

  it('still allows the two databases live-stack.cjs and atlas-stack.cjs seed', () => {
    // Not a simulation of the guard — it reads the allowlist and the two stack
    // scripts from disk and checks they still agree.
    const seedSource = readScript('seedDemo.js');
    const allowList = seedSource.match(/const DEMO_DATABASES = \[(.*?)\]/s);
    expect(allowList).not.toBeNull();

    const liveDb = readScript('live-stack.cjs').match(/getUri\('([^']+)'\)/);
    expect(liveDb).not.toBeNull();
    expect(allowList[1]).toContain(`'${liveDb[1]}'`);

    const atlasDb = readScript('atlas-stack.cjs').match(/ATLAS_DEMO_DB \|\| '([^']+)'/);
    expect(atlasDb).not.toBeNull();
    expect(allowList[1]).toContain(`'${atlasDb[1]}'`);

    // And the override those scripts honour is honoured here too.
    expect(allowList[1]).toContain('process.env.ATLAS_DEMO_DB');
  });
});

describe('scripts/seedDemo.js carries no password literal', () => {
  // A password written into this file is published with the repository, and
  // deleting the line later does not unpublish it — it stays in the history. The
  // seed therefore takes passwords from the environment or generates them per
  // run. This test is what stops the next convenient default from creeping back.
  const source = readScript('seedDemo.js');

  it('assigns no password from a string literal', () => {
    // Any `password: '...'` or `password = '...'` — the shape a default takes.
    const literalAssignment = source.match(/password\s*[:=]\s*['"`][^'"`]+['"`]/gi) || [];
    expect(literalAssignment).toEqual([]);
  });

  it('never falls back to a literal when the env variable is absent', () => {
    // `process.env.X || 'something'` is the exact line this rule exists for.
    const envFallbackToLiteral = source.match(/process\.env\.[A-Z_]*PASSWORD[A-Z_]*\s*\|\|\s*['"`]/gi) || [];
    expect(envFallbackToLiteral).toEqual([]);
  });

  it('generates a password with crypto rather than a fixed string', () => {
    expect(source).toMatch(/randomBytes\(/);
  });

  it('no longer pairs the retired admin address with anything', () => {
    // The account was removed; only the comment explaining why may name it, and
    // never next to a credential.
    const lines = source.split('\n').filter((line) => line.includes('admin@weunity.com'));
    lines.forEach((line) => expect(line.trim().startsWith('//')).toBe(true));
  });
});
