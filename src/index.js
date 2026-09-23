import { createServer } from 'http';
import 'dotenv/config';
// import { config } from 'dotenv-flow'; //! replaced with regular dotenv library, bug fix
import { connectDB } from './services/db.js';
import app from './app.js';
import logger from './services/logger.js';
import AppError from './errors/AppError.js';
import errorManagement from './errors/utils/errorManagement.js';
import { assertKnownEnvironment, assertVerificationLinkExposureIsSafe } from './config/environment.js';
import { assertCookieConfig } from './config/cookies.js';
import { assertVerificationLinkTarget } from './services/mailer.js';

/**
 * REFUSE TO BOOT INTO AN ENVIRONMENT NOBODY NAMED.
 *
 * This is the first thing the server does, before it connects to a database and
 * before it listens, because everything after it branches on the answer.
 *
 * package.json's `start` is `node src/index.js` — no NODE_ENV — and that is the
 * command a hosting platform runs. There is no Dockerfile, Procfile or deploy
 * workflow in this repository pinning one either. An unset or unrecognised value
 * is therefore the realistic deployment state, not an edge case, and treating it
 * as "not production" is what shipped the session cookie without `secure` and
 * kept localhost on the CORS allowlist beside Allow-Credentials: true.
 *
 * Note what this does NOT do: it does not pick a side for the operator. Defaulting
 * to production would break every developer who forgot to export anything;
 * defaulting to development is the bug itself. The only honest answer to an
 * ambiguous environment is to stop and say so.
 *
 * `npm start` is deliberately left without a NODE_ENV. Baking one in would make
 * this check unreachable through the very command it exists to protect, and the
 * project would go back to having an implicit answer — just written down in a
 * different file. Deployments configure NODE_ENV; `npm run local` / `dev` / `prod`
 * already set it for the three local cases.
 *
 * (The imports above have already run by the time this executes — that is how ES
 * modules work. Nothing they do at import time acts on the ambiguous value:
 * middlewares/cors.js builds an allowlist, and it is now fail-closed, so the worst
 * case is an allowlist that is discarded microseconds later with the process.)
 */
try {
  assertKnownEnvironment();
  // Same moment, same reason: a malformed COOKIE_SECURE or COOKIE_SAMESITE should
  // be a refusal to start, not a 500 on the first login of the day.
  assertCookieConfig();
  // And the same again for the two settings that decide where an email-verification
  // link goes and whether it is emailed at all. Both are silent when wrong: a link
  // built against the wrong host 404s in the recipient's inbox, and the exposure
  // flag hands the token to whoever called the endpoint.
  assertVerificationLinkExposureIsSafe();
  assertVerificationLinkTarget();
} catch (err) {
  // console, not the logger: the logger's own format is chosen by NODE_ENV, and
  // this message must survive NODE_ENV being the thing that is wrong.
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
}

// config({ path: './config/' }); //! replaced with regular dotenv library, bug fix
connectDB()
  .then(() => logger.info('DB connected'))
  .catch(() => {
    throw new AppError(
      errorManagement.commonErrors.databaseError.message,
      errorManagement.commonErrors.databaseError.code,
      true,
    );
  });
const httpServer = createServer(app);
const port = process.env.PORT || 5001;
httpServer.listen(port, () => {
  logger.info(`server listening on port ${port} (${process.env.NODE_ENV || 'default'} mode)`);
});

// Finish in-flight requests before exiting, so a deploy or scale-down event
// never cuts a response off mid-body. Docker sends SIGTERM on `docker stop`.
const shutdown = (signal) => {
  logger.info(`${signal} received, closing server`);
  httpServer.close(() => {
    logger.info('server closed');
    process.exit(0);
  });
  // Hard stop if something keeps the event loop alive past the grace period.
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
