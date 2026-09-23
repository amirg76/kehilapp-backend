import logger from './logger.js';
import { isKnownNonProduction, nodeEnvName } from '../config/environment.js';

/**
 * Pluggable outbound mail.
 *
 * Sending email is a real external dependency, and the app must run — in
 * development, in CI, in a reviewer's checkout — without one configured. So the
 * default transport is "log the link": nothing leaves the process, and the
 * developer copies the link out of the terminal.
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
 * `delivered:false` means the message was only logged. It is reported to the
 * caller as a plain boolean so the UI can say "we could not send it, try again"
 * instead of "check your inbox" for an inbox nothing was sent to. It is NOT, by
 * itself, permission to echo the token back — see mayExposeVerificationLink().
 */

/**
 * Where the link in the email points.
 *
 * WHY THIS IS THE RESIDENT APP AND NOT THIS SERVER. `/verify-email` is a route in
 * the React app; this server only exposes `POST /api/auth/verify-email`, which the
 * app calls once it has read `?token=` out of the URL. The default used to be
 * this server's own origin, so the one link a recipient can click resolved to a
 * host with no such route.
 *
 * Nothing caught it because nothing used it: the demo echoed the token back to
 * the browser and the app built its own in-app link from that. Closing the echo
 * is what promotes this from dead code to the only path there is, so the default
 * moves to the resident app's dev origin — the same 5180 both stack scripts and
 * the CORS allowlist already name — and production must say it out loud.
 */
const RESIDENT_APP_DEV_ORIGIN = 'http://localhost:5180';

const rawAppBaseUrl = () => (process.env.APP_BASE_URL || '').trim();

/** The configured origin with any trailing slash removed, or the dev default. */
const appBaseUrl = () => rawAppBaseUrl().replace(/\/+$/, '') || RESIDENT_APP_DEV_ORIGIN;

const MAIL_FROM = () => process.env.MAIL_FROM || 'no-reply@kehilapp.local';

/**
 * Refuses to boot on an APP_BASE_URL that would produce an unclickable link.
 * Throws — the caller decides how to die.
 *
 * Two failures, both silent in production: the variable is unset (every recipient
 * gets a link to localhost) or it is not an absolute http(s) URL (a bare hostname
 * yields `example.com/verify-email?token=…`, which mail clients do not linkify and
 * browsers read as a relative path). Neither surfaces here — both surface in a
 * stranger's inbox, days later, as "the link does nothing".
 */
export const assertVerificationLinkTarget = () => {
  const configured = rawAppBaseUrl();

  if (!configured) {
    if (isKnownNonProduction()) return;
    throw new Error(
      `APP_BASE_URL is not set and NODE_ENV=${nodeEnvName()} is not a development environment. It is the origin of ` +
        `the RESIDENT APP (the React site), not of this server — it is where the /verify-email link in every ` +
        `verification email points, and unset it would send every recipient to ${RESIDENT_APP_DEV_ORIGIN}. ` +
        `Set it to the address people actually open, e.g. https://kehilapp.example.com.`,
    );
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(
      `APP_BASE_URL=${configured} is not a URL this server can build a link from. It must be an absolute origin ` +
        `including the scheme, e.g. https://kehilapp.example.com — a bare hostname produces a link no mail client ` +
        `will make clickable.`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `APP_BASE_URL=${configured} uses the "${parsed.protocol}" scheme. A verification link has to be http or https.`,
    );
  }
};

/** The link the user clicks. The SPA reads ?token=… and POSTs it to /verify-email. */
export const buildVerificationLink = (token) => `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;

const SUBJECT = 'אימות כתובת המייל שלך — קהילאפ';

/**
 * The message body, in Hebrew and right-to-left, because the entire application
 * is. `dir="rtl"` sits on the wrapper element rather than on <html>: a mail client
 * decides for itself how much of the document it keeps, and the attribute has to
 * survive that.
 *
 * A plain-text alternative goes out beside it. It is what a text-only client
 * shows, and its absence is itself a spam signal in several filters.
 */
const htmlBody = (
  link,
) => `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1e293b">
  <h1 style="font-size:20px;margin:0 0 16px">ברוכים הבאים לקהילאפ</h1>
  <p style="margin:0 0 16px">כדי להשלים את ההרשמה, יש לאמת את כתובת המייל הזו:</p>
  <p style="margin:0 0 24px"><a href="${link}" style="background:#0f766e;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">אימות כתובת המייל</a></p>
  <p style="margin:0 0 8px;font-size:14px;color:#475569">אם הכפתור אינו עובד, יש להעתיק את הכתובת הזו לדפדפן:</p>
  <p style="margin:0 0 24px;font-size:14px;direction:ltr;text-align:right;word-break:break-all"><a href="${link}" style="color:#0f766e">${link}</a></p>
  <p style="margin:0;font-size:14px;color:#475569">לאחר האימות, מנהל הקהילה יאשר את החשבון. עד אז יוצג תוכן ציבורי בלבד.</p>
  <p style="margin:16px 0 0;font-size:14px;color:#475569">אם לא נרשמת לקהילאפ, אפשר להתעלם מהודעה זו — לא נוצר חשבון בלי אימות.</p>
</div>`;

const textBody = (link) =>
  [
    'ברוכים הבאים לקהילאפ',
    '',
    'כדי להשלים את ההרשמה, יש לאמת את כתובת המייל הזו:',
    link,
    '',
    'לאחר האימות, מנהל הקהילה יאשר את החשבון. עד אז יוצג תוכן ציבורי בלבד.',
    'אם לא נרשמת לקהילאפ, אפשר להתעלם מהודעה זו.',
  ].join('\n');

const logTransport = (email, link, reason) => {
  // One line, human-readable. With no provider configured this is the ONLY place
  // the link exists, which is what keeps local development working without any
  // mail infrastructure and without the token crossing the network.
  logger.info(`[mailer] verification link for ${email}: ${link}${reason ? ` (${reason})` : ''}`);
  return { link, provider: 'log', delivered: false };
};

const sendViaResend = async (email, link) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return logTransport(email, link, 'EMAIL_PROVIDER=resend but RESEND_API_KEY is unset');

  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: MAIL_FROM(),
        to: email,
        subject: SUBJECT,
        html: htmlBody(link),
        text: textBody(link),
      }),
    });
  } catch (err) {
    // DNS failure, timeout, no outbound network. fetch() rejects rather than
    // returning a response, and an unhandled rejection here would fail the
    // registration request itself — which is the one thing a mail fault must
    // never do. The status code is not in `err`, so it is logged by name.
    logger.error(`[mailer] resend request failed: ${err.name}`);
    return logTransport(email, link, 'resend request failed');
  }

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

  try {
    await transporter.sendMail({
      from: MAIL_FROM(),
      to: email,
      subject: SUBJECT,
      html: htmlBody(link),
      text: textBody(link),
    });
  } catch (err) {
    // Same reasoning as the Resend path: a refused connection or a rejected
    // recipient is a mail fault, not a registration fault.
    logger.error(`[mailer] smtp send failed: ${err.name}`);
    return logTransport(email, link, 'smtp send failed');
  }
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

export default { sendVerificationEmail, buildVerificationLink, assertVerificationLinkTarget };
