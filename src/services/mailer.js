import logger from './logger.js';

/**
 * Pluggable outbound mail.
 *
 * Sending email is a real external dependency, and the app must run — in
 * development, in CI, in a reviewer's checkout — without one configured. So the
 * default transport is "log the link and return it": nothing leaves the process,
 * and a test can read the link straight off the return value.
 *
 * A real provider is opt-in through the environment and is NEVER required:
 *   EMAIL_PROVIDER=resend  + RESEND_API_KEY           → Resend HTTP API
 *   EMAIL_PROVIDER=smtp    + SMTP_HOST/PORT/USER/PASS → SMTP via nodemailer
 * If a provider is selected but its dependency or config is missing, we log a
 * warning and fall back to the log transport rather than throwing — a missing
 * mailer must never take down registration.
 *
 * Every path returns the same shape:
 *   { link, token, provider, delivered }
 * `delivered:false` means the message was only logged (dev/test), which is the
 * signal the auth controller uses to decide whether it may echo the link back in
 * the response for local testing.
 */

const APP_BASE_URL = () => process.env.APP_BASE_URL || 'http://localhost:5001';
const MAIL_FROM = () => process.env.MAIL_FROM || 'no-reply@kehilapp.local';

/** The link the user clicks. The SPA reads ?token=… and POSTs it to /verify-email. */
export const buildVerificationLink = (token) => `${APP_BASE_URL()}/verify-email?token=${encodeURIComponent(token)}`;

const logTransport = (email, link, reason) => {
  // One line, human-readable; the raw link is only ever exposed here (dev/test)
  // and in the returned object.
  logger.info(`[mailer] verification link for ${email}: ${link}${reason ? ` (${reason})` : ''}`);
  return { link, provider: 'log', delivered: false };
};

const sendViaResend = async (email, link) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return logTransport(email, link, 'EMAIL_PROVIDER=resend but RESEND_API_KEY is unset');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: MAIL_FROM(),
      to: email,
      subject: 'Verify your email',
      html: `<p>Confirm your account:</p><p><a href="${link}">${link}</a></p>`,
    }),
  });

  if (!res.ok) {
    // Do not leak the provider's error to the client; log and fall back so the
    // account still gets created and the user can request a resend.
    logger.error(`[mailer] resend send failed (${res.status})`);
    return logTransport(email, link, 'resend send failed');
  }
  return { link, provider: 'resend', delivered: true };
};

const sendViaSmtp = async (email, link) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) return logTransport(email, link, 'EMAIL_PROVIDER=smtp but SMTP_HOST is unset');

  let nodemailer;
  try {
    // Optional dependency: imported only if SMTP is actually selected, so the
    // app does not require nodemailer to be installed.
    ({ default: nodemailer } = await import('nodemailer'));
  } catch {
    return logTransport(email, link, 'nodemailer is not installed');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });

  await transporter.sendMail({
    from: MAIL_FROM(),
    to: email,
    subject: 'Verify your email',
    html: `<p>Confirm your account:</p><p><a href="${link}">${link}</a></p>`,
  });
  return { link, provider: 'smtp', delivered: true };
};

/**
 * Sends (or logs) the verification link for `email`, given the raw token.
 * Never throws for a "no provider" condition — only a real provider fault
 * propagates, and even those degrade to the log transport where sensible.
 */
export const sendVerificationEmail = async ({ email, token }) => {
  const link = buildVerificationLink(token);
  const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();

  let result;
  if (provider === 'resend') {
    result = await sendViaResend(email, link);
  } else if (provider === 'smtp') {
    result = await sendViaSmtp(email, link);
  } else {
    result = logTransport(email, link);
  }

  return { token, ...result };
};

export default { sendVerificationEmail, buildVerificationLink };
