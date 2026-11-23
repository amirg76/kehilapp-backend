/**
 * Login must not tell an attacker which emails are registered by how long it
 * takes to say no (22.11.2026).
 *
 * The old dummy hash for an unknown email was malformed (66 characters), and
 * bcryptjs answers a malformed hash at once: the live backend took about 20 ms
 * for an unknown email and 300-360 ms for a registered one. Same 401, but the
 * clock gave the answer away.
 *
 * Named *.int.test.js so the jest `int` project provides the in-memory MongoDB.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import { dummyPasswordHash } from '../apps/auth/domain/authController.js';

// The cost real accounts are stored at (register and scripts/seedDemo.js).
const STORED_COST = 12;

jest.setTimeout(60000);

beforeAll(async () => {
  await User.create({
    name: 'Timing Test',
    email: 'real@test.example.com',
    role: 'member',
    passwordHash: await bcrypt.hash('correct-horse-battery', STORED_COST),
    emailVerified: true,
    approved: true,
  });
});

// No afterAll cleanup: jest.mongo.setup.js closes the connection first, and
// each test file gets its own in-memory database, stopped with the file.

it('the dummy hash is a real bcrypt hash at the stored cost', async () => {
  const hash = await dummyPasswordHash();
  expect(hash).toHaveLength(60);
  expect(bcrypt.getRounds(hash)).toBe(STORED_COST);
});

const timeLogin = async (email) => {
  const start = process.hrtime.bigint();
  const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong-wrong-wrong' });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  expect(res.status).toBe(401);
  return ms;
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

it('an unknown email is refused about as slowly as a wrong password', async () => {
  // The first unknown-email login also builds the dummy hash; leave it out.
  await timeLogin('warmup@test.example.com');

  const known = [];
  const unknown = [];
  for (let i = 0; i < 3; i++) {
    known.push(await timeLogin('real@test.example.com'));
    unknown.push(await timeLogin(`ghost${i}@test.example.com`));
  }
  // Loose on purpose, so a busy machine does not fail it: the bug this guards
  // made the unknown email about 300 times faster, not a little.
  expect(median(unknown)).toBeGreaterThan(median(known) * 0.5);
});
