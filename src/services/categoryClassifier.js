import Anthropic from '@anthropic-ai/sdk';

import { getCategoriesFromDb } from '../apps/categories/dataAccess/categoryRepository.js';
import { messageUrgencyLevels } from '../config/validationConstants.js';
import AppError from '../errors/AppError.js';
import errorManagement from '../errors/utils/errorManagement.js';
import logger, { forLog } from './logger.js';

/**
 * Suggests a category and an urgency level for a message an admin is writing.
 *
 * WHAT THIS IS NOT. It never assigns anything. The caller gets a suggestion and
 * a one-line reason, and a human presses save — so a wrong answer here costs a
 * click, not a miscategorised board. Everything below is written to keep it that
 * way: the model proposes, this file decides what is allowed to leave it.
 *
 * The API key is optional. When it is absent this module is still importable and
 * the rest of the server is untouched — see isClassifierConfigured, and the 503
 * in messagesController.
 */

/**
 * The model id, overridable per deployment so swapping models is a config change
 * rather than a code change.
 *
 * The default is the bare id exactly as the model reference writes it. Ids there
 * are complete as-is; appending a date suffix from memory names a DIFFERENT
 * model, and the request fails at the API with nothing in this repository to
 * explain why.
 */
const DEFAULT_MODEL = 'claude-opus-5';

/** Classification is one short JSON object; 512 leaves room for the reason sentence. */
const MAX_TOKENS = 512;

/**
 * The shape the model is REQUIRED to answer in, as plain JSON Schema.
 *
 * This is passed as a structured-output format, which is what makes the parse
 * below deterministic instead of a guess at prose. Without it the answer is free
 * text, and every caller ends up writing a fragile "find the JSON in the reply"
 * regex — the kind of parser that works until the day the model adds a sentence
 * in front of it.
 *
 * `additionalProperties: false` is part of the contract, not decoration: it is
 * what stops an extra field from arriving and being quietly passed through to a
 * caller that never asked for one.
 *
 * Plain object literal on purpose — zod is not a dependency of this project and
 * one schema is not a reason to make it one.
 */
const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    categoryTitle: {
      type: 'string',
      description: 'The title of the single best-fitting category, copied exactly from the list given.',
    },
    urgency: {
      type: 'string',
      enum: messageUrgencyLevels,
      description: 'How soon a reader needs to act on this message.',
    },
    reason: {
      type: 'string',
      description: 'One short sentence in Hebrew explaining the choice. It is shown to the admin.',
    },
  },
  required: ['categoryTitle', 'urgency', 'reason'],
  additionalProperties: false,
};

/** The 503 used when the feature is configured away or has nothing to work with. */
const unavailableError = (message) =>
  new AppError(message || errorManagement.commonErrors.serviceUnavailable.message, 503, true);

/** The 502 used when the upstream model answered, but not with something usable. */
const upstreamError = (message) => new AppError(message || errorManagement.commonErrors.badGateway.message, 502, true);

/**
 * True when an API key is actually present.
 *
 * Read at CALL time, not at import time. An import-time read freezes the answer
 * into the module registry, which in a test run means whichever test file loaded
 * this module first decides the answer for every test after it.
 *
 * `.trim()` because an empty or whitespace-only value in a .env file is the
 * common way this ends up "set" while being no key at all — and that must read
 * as "off", not as "on and broken".
 */
export const isClassifierConfigured = () => Boolean((process.env.ANTHROPIC_API_KEY || '').trim());

/**
 * The client, built per call rather than once at module load.
 *
 * Module-load construction would run before jest.setup.env.cjs-style env setup in
 * some import orders, and would pin one client for the process lifetime — so a
 * key rotated in the environment would never be picked up without a restart. The
 * constructor is cheap; the connection is not held open between calls.
 *
 * Zero-arg on purpose: the SDK resolves ANTHROPIC_API_KEY itself. Passing the
 * value through this file would put a secret in one more stack frame for no gain.
 */
const buildClient = () =>
  new Anthropic({
    // Both values override SDK DEFAULTS that are wrong for a billed call sitting
    // behind a request-counting limiter.
    //
    // maxRetries defaults to 2, so one admin click could become three upstream
    // calls — each billed — while classifyLimiter, which counts REQUESTS THIS
    // SERVER RECEIVED, recorded one. The budget it enforces would have been off
    // by 3x in the worst case, and off by an amount nothing in this process can
    // observe. A suggestion is also the cheapest thing in the app to retry: the
    // admin is sitting in front of the form and can press the button again, and
    // when they do, the limiter sees it.
    //
    // timeout defaults to ten minutes. A request that hangs holds an express
    // handler and leaves the admin watching a spinner with no way to tell a slow
    // answer from a dead one. Measured on this machine (18.9.2026): three live
    // classifications returned in 2.9s, 3.9s and 4.0s, so 20s is roughly five
    // times the observed worst case — long enough not to cut off a slow-but-real
    // answer, short enough to fail while the admin is still watching.
    maxRetries: 0,
    timeout: 20_000,
  });

/**
 * The instruction the model works from.
 *
 * The category titles are INTERPOLATED, not hard-coded. See classifyMessage for
 * why that matters; here it only means the prompt text changes whenever the board
 * changes, which is also why nothing in this file is cached between calls.
 */
const buildSystemPrompt = (categoryTitles) =>
  [
    'You classify short notices written by the administrators of an Israeli kibbutz community board.',
    'The notices are in Hebrew.',
    '',
    'Choose exactly one category from this list, copying its title character for character:',
    ...categoryTitles.map((title) => `- ${title}`),
    '',
    'Then choose an urgency level:',
    '- routine: general information, no action needed soon.',
    '- important: the reader should act, but not today.',
    '- urgent: the reader needs this now (safety, a closure, a same-day deadline).',
    '',
    'Answer with the required JSON object only. The reason field is one short sentence in Hebrew,',
    'written for the administrator who will approve or discard your suggestion.',
  ].join('\n');

/**
 * Finds the real category whose title the model returned.
 *
 * Case- and whitespace-insensitive, because the model is being asked to copy a
 * string and a stray space is not a reason to refuse a correct answer. Anything
 * beyond that is not a near-miss — it is a title that does not exist.
 */
const findCategoryByTitle = (categories, returnedTitle) => {
  const wanted = String(returnedTitle || '')
    .trim()
    .toLowerCase();
  if (!wanted) return undefined;
  return categories.find(
    (category) =>
      String(category.title || '')
        .trim()
        .toLowerCase() === wanted,
  );
};

/**
 * Pulls the JSON answer out of the response.
 *
 * `response.content` is a list of typed blocks, not a string, and the text block
 * is not guaranteed to be the first one — a thinking block or a tool block can
 * precede it. Indexing content[0] works right up until it doesn't, and then it
 * fails as an undefined read rather than as a classification failure.
 */
const readJsonAnswer = (response) => {
  // stop_reason is checked BEFORE content is touched. A policy refusal is an
  // HTTP 200 with stop_reason 'refusal' — it is a real outcome of a normal call,
  // not an exception the SDK throws, so a parser that goes straight to content
  // treats a refusal as a malformed answer and reports the wrong failure.
  if (response.stop_reason === 'refusal') {
    throw upstreamError('The classification model declined to answer this message.');
  }
  // A truncated answer is invalid JSON, so the parse below would catch it too —
  // but it would report "the model answered nonsense" for what is actually a
  // max_tokens that needs raising.
  if (response.stop_reason === 'max_tokens') {
    throw upstreamError('The classification answer was cut off before it was complete.');
  }

  const textBlock = (response.content || []).find((block) => block && block.type === 'text');
  if (!textBlock) {
    throw upstreamError('The classification model returned no answer to read.');
  }

  try {
    return JSON.parse(textBlock.text);
  } catch (parseError) {
    logger.warn(`classifier: unparseable answer - ${forLog(textBlock.text)}`);
    throw upstreamError('The classification model returned an answer that could not be read.');
  }
};

/**
 * Turns an SDK failure into an AppError the global handler can serve.
 *
 * Most-specific-first, and on the SDK's typed classes — never on the text of
 * error.message. Matching on message text is matching on something nobody
 * promised to keep stable; it passes review, then silently stops matching after
 * a dependency bump and every upstream failure collapses into one generic 500.
 *
 * The status codes say whose problem it is: a rejected key is this server's
 * misconfiguration and the caller can do nothing about it (503), an upstream
 * rate limit is temporary and retryable (429, and deliberately distinct from
 * classifyLimiter's own 429), anything else upstream is a bad gateway (502).
 */
const toAppError = (error) => {
  if (error instanceof AppError) return error;

  if (error instanceof Anthropic.AuthenticationError) {
    logger.error(`classifier: the API key was rejected upstream (${error.status})`);
    return unavailableError('The classification service is not correctly configured.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AppError(errorManagement.commonErrors.tooManyRequests.message, 429, true);
  }
  if (error instanceof Anthropic.APIError) {
    logger.error(`classifier: upstream API error ${error.status} - ${forLog(error.message)}`);
    return upstreamError('The classification service is temporarily unavailable.');
  }

  // Not an SDK error at all — a bug in this file, or the database read above.
  // isOperational stays false so globalErrorHandler logs the stack and answers
  // with a generic 500 instead of handing internals to the caller.
  return error;
};

/**
 * Suggests a category and an urgency for one message.
 *
 * Returns { categoryId, categoryTitle, urgency, reason }, where categoryId and
 * categoryTitle come from the DATABASE record — never from the model's reply.
 *
 * Throws an AppError the caller can pass to next(). Callers must check
 * isClassifierConfigured() first; this function does not, because "no key" is a
 * deployment state the HTTP layer answers with a 503, not an error to log.
 */
export const classifyMessage = async ({ title, text }) => {
  // DESIGN DECISION 1 — the category list is read from the database on every
  // call and injected into the prompt.
  //
  // A list hard-coded here would be a second, invisible copy of the board's
  // categories. Adding a category in the admin panel would then leave
  // classification quietly working off the old set: no error, no warning, no
  // failing test — just suggestions that can never name the new category, and
  // nothing anywhere pointing at this file as the reason.
  const categories = await getCategoriesFromDb();

  // Nothing to choose from. Refusing here beats asking the model to pick from an
  // empty list and then rejecting whatever it invents, which is the same outcome
  // with a paid API call in the middle of it.
  if (!categories || categories.length === 0) {
    throw unavailableError('There are no categories to classify into yet.');
  }

  const client = buildClient();

  let response;
  try {
    response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      // Both knobs live inside output_config. `format` is the structured-output
      // contract read by readJsonAnswer; `effort: 'low'` is the documented
      // setting for a classification workload — this is a one-shot label on a
      // paragraph, and the depth that helps a long reasoning task only costs
      // tokens and latency here.
      //
      // Absent by design: `thinking`, `budget_tokens`, `temperature`, `top_p`
      // and an assistant prefill. The model reference lists each as removed on
      // this model — sending one is a 400, not a no-op, so they are not
      // harmless leftovers to carry along from an older integration.
      output_config: {
        format: { type: 'json_schema', schema: CLASSIFICATION_SCHEMA },
        effort: 'low',
      },
      system: buildSystemPrompt(categories.map((category) => category.title)),
      messages: [
        {
          role: 'user',
          content: [`כותרת: ${title}`, `תוכן: ${text || '(ללא תוכן)'}`].join('\n'),
        },
      ],
    });
  } catch (error) {
    throw toAppError(error);
  }

  const answer = readJsonAnswer(response);

  // DESIGN DECISION 2 — the model's answer is checked against reality before any
  // of it is handed back.
  //
  // A model asked to copy a title from a list can return a title that reads
  // perfectly and does not exist — a near-synonym, a merged pair, a category
  // this board had a year ago. Trusting the string would mean returning a
  // categoryId the server made up, or worse, none at all while the response
  // still looks like a success. So the title is looked up in the rows that were
  // just fetched, and the id that leaves this function is the id of a category
  // that is provably there.
  const category = findCategoryByTitle(categories, answer.categoryTitle);
  if (!category) {
    logger.warn(`classifier: rejected an unknown category title - ${forLog(String(answer.categoryTitle))}`);
    throw upstreamError('The classification model suggested a category that does not exist.');
  }

  // Same rule for urgency. The schema's enum makes a bad value unlikely rather
  // than impossible, and "unlikely" is not a guarantee this server should build
  // on when the value is about to be written to a document whose own enum would
  // reject it later, deeper, and with a worse error.
  if (!messageUrgencyLevels.includes(answer.urgency)) {
    logger.warn(`classifier: rejected an unknown urgency - ${forLog(String(answer.urgency))}`);
    throw upstreamError('The classification model suggested an urgency level that does not exist.');
  }

  return {
    // String(): _id is an ObjectId on a lean read and would otherwise be
    // serialised by whatever res.json decides to do with it.
    categoryId: String(category._id),
    // The stored title, not the one that came back — the reply is allowed to
    // differ in case and spacing, and the admin should see the real record.
    categoryTitle: category.title,
    urgency: answer.urgency,
    reason: String(answer.reason || ''),
  };
};
