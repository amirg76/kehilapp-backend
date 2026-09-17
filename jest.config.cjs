/**
 * Two projects, split by what a test actually needs.
 *
 * unit — no database. Runs in seconds. The route auth guard lives here: it reads
 *        the Express router tree and never touches Mongo, so making it wait on an
 *        in-memory server was pure cost. A gate that is slow gets skipped, and a
 *        gate that gets skipped is not a gate.
 * int  — integration tests, named *.int.test.js. These get mongodb-memory-server.
 *
 * package.json already had `test:unit` / `test:int` scripts; the split behind them
 * had never been wired up, so every test paid the database startup cost.
 */

const shared = {
  testEnvironment: 'node',
  moduleFileExtensions: ['js'],
  transform: {
    '^.+\.js$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
  },
  // Env placeholders must land before any source module is imported —
  // services/s3.js reads them at import time.
  setupFiles: ['<rootDir>/jest.setup.env.cjs'],
};

module.exports = {
  collectCoverageFrom: ['src/**/*.js'],
  coverageThreshold: {
    global: { branches: 0, functions: 0, lines: 0, statements: 0 },
  },

  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.test.js'],
      testPathIgnorePatterns: ['/node_modules/', '\.int\.test\.js$'],
    },
    {
      ...shared,
      displayName: 'int',
      testMatch: ['<rootDir>/src/**/*.int.test.js'],
      testPathIgnorePatterns: ['/node_modules/'],
      setupFilesAfterEnv: ['<rootDir>/jest.mongo.setup.js'],
    },
  ],
};
