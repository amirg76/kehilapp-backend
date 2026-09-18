/**
 * The maintenance script that removes ONE named account.
 *
 * There is no delete-user route in the API by design, so this capability lives in
 * scripts/removeUserByEmail.js and its contract is its EXIT CODE and what it
 * leaves in the database. These tests run the real file as a child process
 * against a real database and read the documents back afterwards — never the
 * script's own report of what it did.
 *
 * The database is a second database on the SAME in-memory server jest already
 * runs, named so it passes the script's `_demo` guard. Nothing here touches the
 * `test` database the rest of the suite uses.
 *
 * HOW MANY PROCESSES THIS FILE SPAWNS, AND WHY THAT IS THE FLOOR.
 *
 * Five, of which THREE open a database connection. On a loaded CI runner a file
 * that spawned the seed three times against its own in-memory database killed
 * that database — the third spawn timed out opening a connection and the retry
 * could not select a server at all after a full minute. Two commits in this
 * repository record the fixes ("Retry the seed once…", "Prove both environment
 * passwords in one seed run instead of two"), and the standing rule since is to
 * spawn as few as the coverage allows.
 *
 * Each spawn takes exactly one --email and one flag combination, so the three
 * connecting behaviours cannot be folded into fewer runs:
 *   1. dry run        — proves nothing is written AND that the garbled name is
 *                       printed escaped (same run, no extra spawn).
 *   2. --yes          — proves the one account goes and the others stay.
 *   3. zero matches   — proves a wrong address deletes nothing.
 * The remaining two — a non-demo database, and an unrecognised NODE_ENV — refuse
 * BEFORE mongoose.connect is reached, so they cost the in-memory server nothing
 * at all; that is also why they are separate rather than merged.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import mongoose from 'mongoose';

const repoRoot = process.cwd();
const scriptPath = path.join('scripts', 'removeUserByEmail.js');

const DEMO_DB = 'kehilapp_remove_demo';

/** The account the owner approved removing, as it actually arrived. */
const TARGET_EMAIL = 'persist-test@example.com';

/**
 * A name that is garbled the way the real one is — Hebrew UTF-8 bytes decoded as
 * Latin-1 — with two characters a terminal ACTS on rather than shows: U+0007
 * (bell) and U+202E (right-to-left override, which visually reverses the rest of
 * the line). The script must not hand either of them to the terminal raw.
 */
const GARBLED_NAME = 'Ã—Â©Ã—‮';

let demoUri;
let usersCollection;

beforeAll(() => {
  // Same host and port as the suite's memory server, a database of its own.
  const { host, port } = mongoose.connection;
  demoUri = `mongodb://${host}:${port}/${DEMO_DB}`;
  usersCollection = mongoose.connection.getClient().db(DEMO_DB).collection('users');
});

beforeEach(async () => {
  await usersCollection.deleteMany({});
  await usersCollection.insertMany([
    // The one to remove.
    {
      name: GARBLED_NAME,
      email: TARGET_EMAIL,
      role: 'member',
      passwordHash: 'x',
      emailVerified: true,
      approved: true,
    },
    // Two bystanders that must survive untouched.
    {
      name: 'מנהל דמו',
      email: 'admin@demo.example.com',
      role: 'admin',
      passwordHash: 'x',
      emailVerified: true,
      approved: true,
    },
    {
      name: 'חבר דמו',
      email: 'member@demo.example.com',
      role: 'member',
      passwordHash: 'x',
      emailVerified: true,
      approved: true,
    },
  ]);
});

// No afterAll cleanup on purpose: jest.mongo.setup.js closes the connection in
// its own afterAll, which runs first, and the whole in-memory server is thrown
// away with it. beforeEach already gives every test a clean collection.

const runScript = (args = [], env = {}) => {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development', ATLAS_DEMO_DB: DEMO_DB, MONGO_URI: demoUri, ...env },
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
};

const emails = async () =>
  (await usersCollection.find({}).project({ email: 1, _id: 0 }).toArray()).map((d) => d.email).sort();

describe('scripts/removeUserByEmail.js — dry run is the default', () => {
  jest.setTimeout(120000);

  it('prints the match, escapes the garbled name, and deletes NOTHING', async () => {
    const { status, stdout } = runScript(['--email', TARGET_EMAIL]);

    expect(status).toBe(0);
    expect(stdout).toMatch(/before: 3 account\(s\), 1 matching persist-test@example\.com/);
    expect(stdout).toMatch(/DRY RUN — nothing was deleted/);

    // The three fields it is allowed to print, and the _id must be a real one.
    const stored = await usersCollection.findOne({ email: TARGET_EMAIL });
    expect(stdout).toContain(`_id:   ${stored._id}`);
    expect(stdout).toContain(`email: ${TARGET_EMAIL}`);
    expect(stdout).toContain('role:  member');
    // ...and nothing else from the document.
    expect(stdout).not.toMatch(/passwordHash/);
    expect(stdout).not.toMatch(/emailVerified/);

    // THE ESCAPING. The name is quoted, the bell is a visible six-character
    // escape, and the raw control character never reaches the terminal.
    expect(stdout).toContain(`name:  ${JSON.stringify(GARBLED_NAME)}`);
    expect(stdout).toContain('\\u0007');
    expect(stdout).not.toContain('');

    // The contract is the database, not the report.
    expect(await emails()).toEqual(['admin@demo.example.com', 'member@demo.example.com', TARGET_EMAIL].sort());
  });
});

describe('scripts/removeUserByEmail.js — with --yes', () => {
  jest.setTimeout(120000);

  it('deletes exactly the named account and leaves every other one alone', async () => {
    const before = await usersCollection.findOne({ email: 'admin@demo.example.com' });

    const { status, stdout } = runScript(['--email', TARGET_EMAIL, '--yes']);

    expect(status).toBe(0);
    expect(stdout).toMatch(/before: 3 account\(s\), 1 matching/);
    // Re-read from the database, not reported by deleteOne.
    expect(stdout).toMatch(/after: 2 account\(s\), 0 matching/);

    expect(await usersCollection.findOne({ email: TARGET_EMAIL })).toBeNull();
    expect(await emails()).toEqual(['admin@demo.example.com', 'member@demo.example.com']);

    // Byte for byte: the bystander was not rewritten, only left alone.
    const after = await usersCollection.findOne({ email: 'admin@demo.example.com' });
    expect(after).toEqual(before);
  });
});

describe('scripts/removeUserByEmail.js — refusals', () => {
  jest.setTimeout(120000);

  it('refuses when no account matches, and deletes nothing', async () => {
    const { status, stderr } = runScript(['--email', 'nobody@example.com', '--yes']);

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/no account matches nobody@example\.com/);
    expect(await emails()).toEqual(['admin@demo.example.com', 'member@demo.example.com', TARGET_EMAIL].sort());
  });

  it('refuses a database that is not a demo database, even with --yes', async () => {
    // Refused before any connection is opened, so this costs the in-memory
    // server nothing.
    const { status, stderr } = runScript(['--email', TARGET_EMAIL, '--yes'], {
      ATLAS_DEMO_DB: '',
      MONGO_URI: 'mongodb+srv://user:pass@cluster0.example.mongodb.net/kehilapp_live?retryWrites=true',
    });

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/kehilapp_live/);
    expect(stderr).not.toMatch(/pass@/); // the refusal must not echo credentials
    expect(await emails()).toEqual(['admin@demo.example.com', 'member@demo.example.com', TARGET_EMAIL].sort());
  });

  it('refuses an NODE_ENV it does not recognise', async () => {
    // Default-deny: 'staging' is on neither list, so it is treated as dangerous
    // rather than as development. Also refused before connecting.
    const { status, stderr } = runScript(['--email', TARGET_EMAIL, '--yes'], { NODE_ENV: 'staging' });

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/NODE_ENV=staging/);
    expect(stderr).toMatch(/no production mode/);
    expect(await emails()).toEqual(['admin@demo.example.com', 'member@demo.example.com', TARGET_EMAIL].sort());
  });
});
