/**
 * The one-off migration that admits the accounts which already existed.
 *
 * Adding `approved` with `default: false` makes every pre-existing account read
 * as pending, so a deploy would silently drop long-standing members to
 * public-only content. scripts/approveExistingUsers.js admits them once.
 *
 * It is a script, so the contract is its EXIT CODE and what it leaves in the
 * database. These tests run the real file as a child process against a real
 * database and then read the documents back — never the script's own report of
 * what it did.
 *
 * The database is a second database on the SAME in-memory server jest already
 * runs, named `kehilapp` so it passes the script's demo-database guard. Nothing
 * here touches the `test` database the rest of the suite uses.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import mongoose from 'mongoose';

const repoRoot = process.cwd();
const scriptPath = path.join('scripts', 'approveExistingUsers.js');

const DEMO_DB = 'kehilapp';

let demoUri;
let usersCollection;

beforeAll(() => {
  // Same host and port as the suite's memory server, different database.
  const { host, port } = mongoose.connection;
  demoUri = `mongodb://${host}:${port}/${DEMO_DB}`;
  usersCollection = mongoose.connection.getClient().db(DEMO_DB).collection('users');
});

beforeEach(async () => {
  await usersCollection.deleteMany({});
  await usersCollection.insertMany([
    // Written before the field existed: no `approved` key at all. This is the
    // document a naive `{ approved: false }` filter would skip.
    {
      name: 'Old Member',
      email: 'old-member@test.example.com',
      role: 'member',
      passwordHash: 'x',
      emailVerified: true,
    },
    // Explicitly pending.
    {
      name: 'Pending Member',
      email: 'pending@test.example.com',
      role: 'member',
      passwordHash: 'x',
      emailVerified: true,
      approved: false,
    },
    // Already admitted, with its own trail. Must be left completely alone.
    {
      name: 'Approved Member',
      email: 'already@test.example.com',
      role: 'member',
      passwordHash: 'x',
      emailVerified: true,
      approved: true,
      approvedBy: 'some-admin-id',
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
    env: { ...process.env, NODE_ENV: 'development', MONGO_URI: demoUri, ...env },
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
};

const unapprovedCount = () =>
  usersCollection.countDocuments({ $or: [{ approved: { $exists: false } }, { approved: false }] });

describe('scripts/approveExistingUsers.js — refusals', () => {
  jest.setTimeout(120000);

  it('refuses NODE_ENV=production with a non-zero exit, writing nothing', async () => {
    const { status, stderr } = runScript([], { NODE_ENV: 'production' });

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/production/i);
    expect(await unapprovedCount()).toBe(2); // untouched
  });

  it('refuses a database that is not a demo database, even with --yes', async () => {
    const { status, stderr } = runScript(['--yes'], {
      MONGO_URI: 'mongodb+srv://user:pass@cluster0.example.mongodb.net/kehilapp_live?retryWrites=true',
    });

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/kehilapp_live/);
    expect(stderr).not.toMatch(/pass@/); // the refusal must not echo credentials
    expect(await unapprovedCount()).toBe(2);
  });
});

describe('scripts/approveExistingUsers.js — dry run is the default', () => {
  jest.setTimeout(120000);

  it('reports what it would change and writes NOTHING without --yes', async () => {
    const { status, stdout } = runScript([]);

    expect(status).toBe(0);
    expect(stdout).toMatch(/before: 2 unapproved of 3/);
    expect(stdout).toMatch(/DRY RUN/);
    expect(stdout).toMatch(/old-member@test\.example\.com/);

    // The contract is the database, not the report.
    expect(await unapprovedCount()).toBe(2);
    const old = await usersCollection.findOne({ email: 'old-member@test.example.com' });
    expect(old.approved).toBeUndefined();
  });
});

describe('scripts/approveExistingUsers.js — with --yes', () => {
  jest.setTimeout(120000);

  it('approves the missing-field and false accounts, and only those', async () => {
    const { status, stdout } = runScript(['--yes']);

    expect(status).toBe(0);
    expect(stdout).toMatch(/before: 2 unapproved of 3/);
    expect(stdout).toMatch(/after: 0 unapproved of 3/);

    expect(await unapprovedCount()).toBe(0);

    // The document with no `approved` key at all — the one this migration is
    // really for — must have been caught.
    const old = await usersCollection.findOne({ email: 'old-member@test.example.com' });
    expect(old.approved).toBe(true);
    expect(old.approvedBy).toBe('migration:approveExistingUsers');
    expect(old.approvedAt).toBeInstanceOf(Date);

    // The already-approved account keeps its own trail: the migration must not
    // rewrite who admitted it.
    const already = await usersCollection.findOne({ email: 'already@test.example.com' });
    expect(already.approvedBy).toBe('some-admin-id');
  });

  it('is a no-op on a second run', async () => {
    expect(runScript(['--yes']).status).toBe(0);
    const second = runScript(['--yes']);

    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/before: 0 unapproved of 3/);
    expect(second.stdout).toMatch(/modified: 0/);
    expect(await unapprovedCount()).toBe(0);
  });
});
