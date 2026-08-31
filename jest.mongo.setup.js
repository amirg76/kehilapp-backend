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
