import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod;

// First run may download a MongoDB binary, and mongod itself can take a while
// to come up on a loaded machine; the 5s/10s defaults are not enough.
jest.setTimeout(180000);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create({
    instance: {
      // Overrides the 10s default that failed on this machine. The env-var
      // route (MONGOMS_LAUNCH_TIMEOUT) does not reach jest workers reliably,
      // so it is pinned in code where it cannot get lost.
      launchTimeout: 120000,
      // mongodb-memory-server defaults to the ephemeralForTest engine, which
      // MongoDB removed in 7.0 -- and 7.0 is what this project pins, because
      // the 5.0 default links against OpenSSL 1.1 and will not start on the
      // Ubuntu 24.04 image CI now runs. wiredTiger is what a real deployment
      // uses anyway, so the tests exercise the same engine as production.
      storageEngine: 'wiredTiger',
    },
  });
  const mongoUri = mongod.getUri();

  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.connection.close();
  // Guard: if create() threw, mongod is undefined and this would mask the real error.
  if (mongod) await mongod.stop();
});
