/**
 * How the storage client is configured.
 *
 * WHY THIS FILE EXISTS. The attachment store used to be AWS S3 and nothing
 * else: the client was built from a region alone and the SDK derived the host.
 * Any S3-compatible service (Cloudflare R2, MinIO) needs two more things —
 * an explicit endpoint and path-style addressing — and the only way to check
 * either without a bucket is to assert on the config object itself. These
 * tests pin both shapes: the AWS one must stay byte-for-byte what it was (an
 * `endpoint: undefined` key is NOT the same thing to the SDK's resolver), and
 * the endpoint one must carry the two keys that make a non-AWS host work.
 */
import { buildS3ClientConfig } from '../services/s3.js';
import { getBucketEndpoint } from '../config/env.js';

// Low-entropy placeholders on purpose: a secret scanner that sees a
// random-looking string here cannot tell it from a leaked one.
const ACCESS_KEY_ID = 'ab'.repeat(8);
const SECRET_ACCESS_KEY = 'cd'.repeat(8);
const R2_ENDPOINT = `https://${'ab'.repeat(16)}.r2.cloudflarestorage.com`;

describe('buildS3ClientConfig — AWS stays exactly as it was', () => {
  const awsShape = {
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    region: 'us-east-1',
  };

  it('returns the region-only config when no endpoint is given', () => {
    const config = buildS3ClientConfig({
      region: 'us-east-1',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(config).toEqual(awsShape);
  });

  it('treats an empty endpoint the same as no endpoint', () => {
    // This is what getBucketEndpoint() returns when BUCKET_ENDPOINT is unset,
    // so it is the shape every existing AWS deployment actually gets.
    const config = buildS3ClientConfig({
      endpoint: '',
      region: 'us-east-1',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(config).toEqual(awsShape);
  });

  it('has no endpoint or forcePathStyle key at all, not even an undefined one', () => {
    // toEqual ignores undefined-valued keys, so it cannot catch this on its own.
    const config = buildS3ClientConfig({
      endpoint: undefined,
      region: 'us-east-1',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(Object.keys(config).sort()).toEqual(['credentials', 'region']);
    expect(config).not.toHaveProperty('endpoint');
    expect(config).not.toHaveProperty('forcePathStyle');
  });
});

describe('buildS3ClientConfig — an S3-compatible endpoint (Cloudflare R2)', () => {
  it('points the client at the endpoint and forces path-style addressing', () => {
    const config = buildS3ClientConfig({
      endpoint: R2_ENDPOINT,
      region: 'auto',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(config).toEqual({
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
      region: 'auto',
      endpoint: R2_ENDPOINT,
      forcePathStyle: true,
    });
  });

  it('passes the credentials and region through unchanged', () => {
    const config = buildS3ClientConfig({
      endpoint: R2_ENDPOINT,
      region: 'auto',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(config.credentials.accessKeyId).toBe(ACCESS_KEY_ID);
    expect(config.credentials.secretAccessKey).toBe(SECRET_ACCESS_KEY);
    expect(config.region).toBe('auto');
  });

  it('treats a whitespace-only endpoint as no endpoint, and trims a padded one', () => {
    const blank = buildS3ClientConfig({
      endpoint: '   ',
      region: 'us-east-1',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    });
    expect(blank).not.toHaveProperty('endpoint');

    const padded = buildS3ClientConfig({
      endpoint: `  ${R2_ENDPOINT}  `,
      region: 'auto',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    });
    expect(padded.endpoint).toBe(R2_ENDPOINT);
  });

  it('refuses a value that is not a URL, at build time rather than on first upload', () => {
    expect(() =>
      buildS3ClientConfig({
        endpoint: 'not a url',
        region: 'auto',
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      }),
    ).toThrow('BUCKET_ENDPOINT is not a valid URL');
  });

  const plainHttp = {
    endpoint: 'http://minio.internal:9000',
    region: 'auto',
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  };

  it('refuses a plain-http endpoint unless plain http is explicitly allowed (local MinIO)', () => {
    expect(() => buildS3ClientConfig({ ...plainHttp, allowPlainHttp: false })).toThrow(
      'BUCKET_ENDPOINT must use https outside a known development environment',
    );
    expect(buildS3ClientConfig({ ...plainHttp, allowPlainHttp: true }).endpoint).toBe('http://minio.internal:9000');
  });

  describe('the default for allowPlainHttp comes from config/environment.js, not a hand-rolled NODE_ENV test', () => {
    const original = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = original;
    });

    // `npm run prod` sets NODE_ENV=prod — the spelling a `=== 'production'` check
    // misses (merge gate, 29.10). Unset/unknown values must fail closed too.
    it.each(['production', 'prod', 'Production', ' PROD ', 'staging', ''])(
      'refuses plain http when NODE_ENV=%j',
      (v) => {
        process.env.NODE_ENV = v;
        expect(() => buildS3ClientConfig(plainHttp)).toThrow('must use https');
      },
    );

    it.each(['development', 'dev', 'local', 'test'])('allows plain http when NODE_ENV=%j', (v) => {
      process.env.NODE_ENV = v;
      expect(buildS3ClientConfig(plainHttp).endpoint).toBe('http://minio.internal:9000');
    });
  });

  it('refuses a non-http(s) scheme and a URL that carries credentials', () => {
    const base = {
      region: 'auto',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      allowPlainHttp: true,
    };
    expect(() => buildS3ClientConfig({ ...base, endpoint: 'localhost:9000' })).toThrow('must be an http(s) URL');
    expect(() => buildS3ClientConfig({ ...base, endpoint: 'ftp://x.example' })).toThrow('must be an http(s) URL');
    expect(() => buildS3ClientConfig({ ...base, endpoint: 'https://user:pw@x.example' })).toThrow(
      'must not carry credentials',
    );
  });
});

describe('getBucketEndpoint — optional, unlike the other BUCKET_ variables', () => {
  const original = process.env.BUCKET_ENDPOINT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BUCKET_ENDPOINT;
    } else {
      process.env.BUCKET_ENDPOINT = original;
    }
  });

  it('returns an empty string when BUCKET_ENDPOINT is unset, instead of throwing', () => {
    delete process.env.BUCKET_ENDPOINT;

    expect(getBucketEndpoint()).toBe('');
  });

  it('returns the value when BUCKET_ENDPOINT is set', () => {
    process.env.BUCKET_ENDPOINT = R2_ENDPOINT;

    expect(getBucketEndpoint()).toBe(R2_ENDPOINT);
  });

  it('trims the value, so a whitespace-only setting reads as unset', () => {
    process.env.BUCKET_ENDPOINT = '   ';

    expect(getBucketEndpoint()).toBe('');
  });
});
