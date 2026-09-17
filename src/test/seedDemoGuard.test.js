/**
 * The demo seed must not be able to run against production.
 *
 * scripts/seedDemo.js deletes every category and message it finds and replaces
 * them with invented demo content. Pointed at a real database that is not
 * recoverable by re-running anything, so the script refuses two ways:
 *
 *   1. NODE_ENV does not name a KNOWN development environment — refuse outright,
 *      before anything connects. Default-deny: the safe list decides, so 'prod',
 *      'staging' and an unset value are all refused rather than only the one
 *      spelling somebody happened to write down.
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

  // A demo-named URI, so the ONLY thing that may stop these runs is the
  // environment check itself.
  const DEMO_URI = 'mongodb://127.0.0.1:27017/kehilapp_demo';

  it('exits non-zero with NODE_ENV=production, before it connects to anything', () => {
    const { status, stderr, stdout } = runSeed({ NODE_ENV: 'production', MONGO_URI: DEMO_URI });

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/NODE_ENV=production/);
    expect(stdout).not.toMatch(/connected/); // it never got as far as a connection
  });

  it('exits non-zero with NODE_ENV=prod — the spelling `npm run prod` sets', () => {
    // package.json: "prod": "cross-env NODE_ENV=prod nodemon src/index.js". The
    // old guard compared against 'production' only, so it was silent here — in
    // exactly the situation it was written for.
    const { status, stderr, stdout } = runSeed({ NODE_ENV: 'prod', MONGO_URI: DEMO_URI });

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/NODE_ENV=prod\b/);
    expect(stdout).not.toMatch(/connected/);
  });

  it('exits non-zero for an environment it does not recognise, and for none at all', () => {
    // Default-deny. 'staging' is not on the safe list, so it is dangerous.
    const staging = runSeed({ NODE_ENV: 'staging', MONGO_URI: DEMO_URI });
    expect(staging.status).not.toBe(0);
    expect(staging.stderr).toMatch(/NODE_ENV=staging/);
    expect(staging.stdout).not.toMatch(/connected/);

    const unset = runSeed({ NODE_ENV: '', MONGO_URI: DEMO_URI });
    expect(unset.status).not.toBe(0);
    expect(unset.stderr).toMatch(/NODE_ENV=\(unset\)/);
    expect(unset.stdout).not.toMatch(/connected/);
  });

  it('exits non-zero against the REAL application database', () => {
    // docs/05-running-locally.md gives every developer
    // mongodb://127.0.0.1:27017/kehilapp as the ordinary application database.
    // `kehilapp` was on the demo allowlist, so the list that protects the real
    // board contained the real board — and this script deletes every category and
    // message it finds.
    const { status, stderr, stdout } = runSeed({
      NODE_ENV: 'development',
      MONGO_URI: 'mongodb://127.0.0.1:27017/kehilapp',
    });

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/"kehilapp"/);
    expect(stdout).not.toMatch(/connected/);
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

    // ...and the application database is NOT on it. `kehilapp` was, which made
    // the guard permit the one database it exists to protect. Both stack scripts
    // must therefore name something else — which is what the two checks above
    // have just read off disk.
    expect(allowList[1]).not.toMatch(/'kehilapp'/);
    expect(liveDb[1]).not.toBe('kehilapp');
    expect(atlasDb[1]).not.toBe('kehilapp');

    // The same allowlist lives in the migration; the two must not drift apart.
    const migrationAllowList = readScript('approveExistingUsers.js').match(/const DEMO_DATABASES = \[(.*?)\]/s);
    expect(migrationAllowList).not.toBeNull();
    expect(migrationAllowList[1]).toEqual(allowList[1]);
  });
});

/**
 * The password checks that used to live here — seven regexes over the seed's
 * source — have moved and changed shape. A reviewer defeated them by putting a
 * hardcoded password under a neutral variable name, which matched none of the
 * patterns. They are replaced by a BEHAVIOURAL test that runs the seed twice and
 * requires the two runs to issue different passwords:
 *
 *     src/test/seedDemoPasswords.int.test.js
 *
 * It needs a database, so it belongs to the `int` project rather than here. The
 * two source checks still worth keeping went with it, where the file that
 * explains their limits can be read alongside them.
 */
