/**
 * The server must refuse to boot into an environment nobody named.
 *
 * WHY THIS IS A GATE AND NOT A PREFERENCE. package.json's `start` script is
 * `node src/index.js` — it sets no NODE_ENV at all, and that is the command a
 * hosting platform runs. No Dockerfile, Procfile or deploy workflow in this
 * repository pins one either. So "NODE_ENV is unset" was the realistic state of a
 * real deployment, and every security branch below it (`secure` on the session
 * cookie, the CORS allowlist) resolved that ambiguity silently, in the permissive
 * direction, because `isProduction()` answers false for anything it does not
 * recognise.
 *
 * These tests run the REAL entry point as a child process, because for a server
 * the exit code and the refusal message are the contract. They never reach a
 * database: the guard runs before connectDB().
 */
import { spawn, spawnSync } from 'child_process';
import path from 'path';

const repoRoot = process.cwd();
const entryPoint = path.join('src', 'index.js');

/** Environment the entry point needs before it can get as far as the guard. */
const BASE_ENV = {
  JWT_SECRET: 'startup-guard-test-secret',
  MONGO_URI: 'mongodb://127.0.0.1:27017/startup_guard_test_demo',
  BUCKET_NAME: 'test-bucket',
  BUCKET_REGION: 'us-east-1',
  BUCKET_ACCESS_KEY: 'test-access-key',
  BUCKET_SECRET_ACCESS_KEY: 'test-secret-access-key',
  // Port 0 = let the OS pick a free one, so a busy 5001 on the developer's
  // machine cannot turn a passing test into a failing one.
  PORT: '0',
};

/** Runs src/index.js to completion. Only safe for cases that are expected to exit. */
const runEntryPoint = (env) => {
  const result = spawnSync(process.execPath, [entryPoint], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ...BASE_ENV, ...env },
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
};

/**
 * Starts src/index.js and resolves once it either dies or reports that it is
 * listening — then kills it. The accepted-value cases must NOT run to completion:
 * a server that boots correctly stays up forever.
 */
const startEntryPoint = (env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [entryPoint], {
      cwd: repoRoot,
      env: { ...process.env, ...BASE_ENV, ...env },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const finish = (status) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.kill();
      resolve({ status, stdout, stderr });
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      // The server prints this from inside httpServer.listen's callback, which
      // means it got past the guard and bound a port.
      if (/server listening on port/.test(stdout)) finish(null);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('exit', (code) => finish(code));

    // The guard fires within milliseconds, so a process still alive at the end of
    // this window has passed it. (The database is not running here; mongoose takes
    // far longer than this to give up, which is why the window is short.)
    timer = setTimeout(() => finish(null), 6000);
  });

describe('src/index.js refuses to start on an environment it cannot name', () => {
  jest.setTimeout(120000);

  it('refuses when NODE_ENV is not set at all — the state `npm start` leaves it in', () => {
    // `"start": "node src/index.js"`. Nothing sets NODE_ENV, and nothing in the
    // repository sets it for the platform either.
    const { status, stderr } = runEntryPoint({ NODE_ENV: undefined });

    expect(status).toBe(1);
    expect(stderr).toMatch(/FATAL/);
    expect(stderr).toMatch(/NODE_ENV=\(unset\)/);
    // It must say what it WOULD accept, or the operator is left guessing.
    expect(stderr).toMatch(/local, dev, development, test, production, prod/);
  });

  it('refuses when NODE_ENV is set to an empty string', () => {
    const { status, stderr } = runEntryPoint({ NODE_ENV: '' });

    expect(status).toBe(1);
    expect(stderr).toMatch(/NODE_ENV=\(unset\)/);
  });

  it('refuses NODE_ENV=staging — recognised by neither list', () => {
    const { status, stderr } = runEntryPoint({ NODE_ENV: 'staging' });

    expect(status).toBe(1);
    expect(stderr).toMatch(/NODE_ENV=staging/);
  });

  it('refuses before it connects to a database', () => {
    const { stdout } = runEntryPoint({ NODE_ENV: 'staging' });

    expect(stdout).not.toMatch(/DB connected/);
    expect(stdout).not.toMatch(/server listening/);
  });

  it.each(['local', 'dev', 'development', 'production', 'prod'])('starts for the accepted value %p', async (value) => {
    const { stdout, stderr } = await startEntryPoint({ NODE_ENV: value });

    expect(stderr).not.toMatch(/FATAL/);
    expect(stdout).toMatch(/server listening on port/);
  });

  it("starts for the accepted value 'test' too", async () => {
    // Checked differently, and only because of how this project logs:
    // services/logger.js sets `silent: NODE_ENV === 'test'`, so the "server
    // listening" line the other five are recognised by is deliberately suppressed
    // here. What is observable instead is that the process is STILL RUNNING at the
    // end of the window — the guard refuses within milliseconds, so anything still
    // alive six seconds later got past it.
    const { status, stderr } = await startEntryPoint({ NODE_ENV: 'test' });

    expect(stderr).not.toMatch(/FATAL/);
    expect(status).toBeNull(); // null = it had to be killed, i.e. it never exited
  });
});

describe('src/index.js refuses to start on a malformed cookie configuration', () => {
  jest.setTimeout(120000);

  it('refuses an unrecognised COOKIE_SECURE rather than reading it as false', () => {
    // The old code was `COOKIE_SECURE === 'true'`, so this value silently
    // DISABLED the session cookie's Secure flag in production.
    const { status, stderr } = runEntryPoint({ NODE_ENV: 'prod', COOKIE_SECURE: 'maybe' });

    expect(status).toBe(1);
    expect(stderr).toMatch(/COOKIE_SECURE/);
  });

  it('refuses an unrecognised COOKIE_SAMESITE rather than 500ing on the first login', () => {
    const { status, stderr } = runEntryPoint({ NODE_ENV: 'prod', COOKIE_SAMESITE: 'sometimes' });

    expect(status).toBe(1);
    expect(stderr).toMatch(/COOKIE_SAMESITE/);
  });
});
