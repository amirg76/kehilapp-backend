import winston from 'winston';

const { createLogger, format, transports } = winston;
const { combine, timestamp, printf, json } = format;

/**
 * The application logger.
 *
 * This module existed, formatted nicely — and logged only to a local file that
 * nothing rotated and no one read, while the app itself used console.log. Two
 * changes:
 *
 *  - stdout is the primary transport. Under Docker/systemd/CloudWatch, stdout IS
 *    the log pipeline; a container writing to ./src/logs loses everything on
 *    restart.
 *  - JSON in production, readable lines in development. Log collectors parse
 *    JSON; humans at a terminal do not.
 */

const readableLine = printf(({ level, message, timestamp: ts, ...meta }) => {
  const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} ${level.toUpperCase()} ${message}${rest}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format:
    process.env.NODE_ENV === 'production'
      ? combine(timestamp(), json())
      : combine(timestamp({ format: 'HH:mm:ss' }), readableLine),
  transports: [new transports.Console()],
  // Stay quiet during tests so suite output stays readable.
  silent: process.env.NODE_ENV === 'test',
  // Never crash the process because a log line could not be written.
  exitOnError: false,
});

export default logger;
