/**
 * Edges of login's dummy hash (see loginTiming.int.test.js for the timing
 * itself). Both would reopen the "is this email registered?" leak:
 *
 *   - a failed build of the dummy must not be cached, or every unknown-email
 *     login would answer 500 while registered ones answer 401;
 *   - a stored hash that is not a well-formed bcrypt hash must be swapped for
 *     the dummy, because bcryptjs answers a malformed hash at once.
 *
 * Its own file: the order matters (the first test must be the first call to
 * dummyPasswordHash in this module), and the login limiter allows only 10
 * failures per file.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../app.js';
import User from '../apps/users/dataAccess/userModel.js';
import { dummyPasswordHash } from '../apps/auth/domain/authController.js';

jest.setTimeout(60000);

afterEach(() => {
  jest.restoreAllMocks();
});

it('a failed dummy-hash build is retried, not kept', async () => {
  jest.spyOn(bcrypt, 'hash').mockRejectedValueOnce(new Error('simulated failure'));
  await expect(dummyPasswordHash()).rejects.toThrow('simulated failure');

  // The next unknown-email login builds a real one and is refused like any
  // wrong password (a kept rejection would make it a 500).
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'ghost@test.example.com', password: 'wrong-wrong-wrong' });
  expect(res.status).toBe(401);

  const hash = await dummyPasswordHash();
  expect(hash).toHaveLength(60);
  expect(bcrypt.getRounds(hash)).toBe(12);
});

it('a stored hash that is not a well-formed bcrypt hash is checked against the dummy', async () => {
  await User.create({
    name: 'Corrupt Hash',
    email: 'corrupt@test.example.com',
    role: 'member',
    passwordHash: 'not-a-bcrypt-hash',
    emailVerified: true,
    approved: true,
  });
  const compare = jest.spyOn(bcrypt, 'compare');

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'corrupt@test.example.com', password: 'wrong-wrong-wrong' });

  expect(res.status).toBe(401);
  expect(compare).toHaveBeenCalledTimes(1);
  const [, usedHash] = compare.mock.calls[0];
  expect(usedHash).toBe(await dummyPasswordHash());
});
