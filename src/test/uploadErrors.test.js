/**
 * Upload error answers.
 *
 * After the multer 2 upgrade a review found two gaps: every multer error code
 * other than the three known ones fell into `next()` with no error, so the
 * client got a 404; and a client hanging up mid-upload was logged as an
 * unhandled 500 bug. These tests drive the real upload middleware and the real
 * error chain with real HTTP requests, no database.
 */
import express from 'express';
import http from 'node:http';
import request from 'supertest';
import upload from '../middlewares/multer.js';
import errorDelegatorMiddleware from '../errors/errorDelegatorMiddleware.js';
import globalErrorHandler from '../errors/globalErrorHandler.js';
import logger from '../services/logger.js';

const buildApp = () => {
  const app = express();
  app.post('/upload', upload.single('file'), (req, res) => res.json({ ok: true, size: req.file?.size ?? 0 }));
  app.use(errorDelegatorMiddleware);
  app.use(globalErrorHandler);
  return app;
};

const png = Buffer.from('89504e470d0a1a0a', 'hex');

describe('upload error answers', () => {
  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts a normal image upload', async () => {
    const res = await request(buildApp())
      .post('/upload')
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('keeps the three known answers: 415 type, 413 size, 413 count', async () => {
    const app = buildApp();
    const type = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('hi'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(type.status).toBe(415);

    const big = await request(app)
      .post('/upload')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'b.png', contentType: 'image/png' });
    expect(big.status).toBe(413);

    const two = await request(app)
      .post('/upload')
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
      .attach('file', png, { filename: 'b.png', contentType: 'image/png' });
    expect(two.status).toBe(413);
  });

  it('answers 400, not 404, for the other multer codes (missing field name)', async () => {
    // An empty field name raises MISSING_FIELD_NAME in multer 2.5 (measured).
    // A long field name does not: fieldNameSize is only checked when set.
    const res = await request(buildApp()).post('/upload').field('', 'v');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs a client that hangs up mid-upload as a warning, not an unhandled bug', async () => {
    const server = buildApp().listen(0);
    const { port } = server.address();
    const boundary = 'testboundary';

    await new Promise((resolve) => {
      const req = http.request({
        port,
        method: 'POST',
        path: '/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': 10 * 1024 * 1024,
        },
      });
      req.on('error', () => resolve());
      req.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
      );
      req.write(Buffer.alloc(64 * 1024));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 200);
    });

    // Give the server time to notice the closed socket and run the error chain.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !warnSpy.mock.calls.length && !errorSpy.mock.calls.length) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => server.close(resolve));

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/^400 POST \/upload - Request (aborted|closed)$/));
  });
});
