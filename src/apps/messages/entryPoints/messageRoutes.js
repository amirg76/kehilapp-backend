import express from 'express';
// authentication + authorization
import auth from '../../../middlewares/auth.js';
import optionalAuth from '../../../middlewares/optionalAuth.js';
import requireRole from '../../../middlewares/requireRole.js';
import requireApproved from '../../../middlewares/requireApproved.js';
// rate limiting
import { classifyLimiter } from '../../../middlewares/rateLimit.js';
// validation
import {
  getMessagesValidation,
  getMessageByIdValidation,
  createMessageValidation,
  updateMessageValidation,
  deleteMessageValidation,
  classifyMessageValidation,
} from './messagesValidation.js';
//upload middleware
import upload from '../../../middlewares/multer.js';
// controllers
import {
  getMessages,
  getMessageById,
  createMessage,
  updateMessage,
  deleteMessage,
  deleteAllMessages,
  classifyMessage,
} from '../domain/messagesController.js';

const router = express.Router();

// Public read: the community board is viewable without signing in (demo/showcase
// posture). Listed explicitly in PUBLIC_ROUTES in the route-guard test so this is
// a reviewed choice, not an accidental hole. Writing still requires auth below.
//
// `optionalAuth` is NOT the strict gate: it never 401s. It only resolves a valid
// session when one is present, so these routes can serve public-only content to
// the public and unlock members-only content for a signed-in caller. An anonymous
// request stays anonymous and sees public content alone.
router.get('/', optionalAuth, getMessagesValidation, getMessages);
router.get('/:id', optionalAuth, getMessageByIdValidation, getMessageById);

// Posting and editing are open to ADMITTED members: these are community
// messages, not announcements from above — but a verified email is not
// membership. `auth` answers "who are you", `requireApproved` answers "are you
// one of us"; only then does the request reach the uploader.
//
// Both guards run before `upload` on purpose: multer consumes the request body,
// and the controller pushes that file to S3. A caller who is anonymous, or
// signed in but not yet admitted, must never get as far as buffering a file —
// let alone leaving an object in the bucket for a write that is then refused.
router.post('/', auth, requireApproved, upload.single('file'), createMessageValidation, createMessage);
router.patch('/:id', auth, requireApproved, upload.single('file'), updateMessageValidation, updateMessage);

// Ask the model to SUGGEST a category and an urgency for a message being
// written. It stores nothing: the admin gets a proposal and still posts through
// POST / above, so the authorisation rules there remain the only way anything
// reaches the collection.
//
// Guard order is the point of this line. `auth` and `requireApproved` come first
// for the same reason they precede multer on the upload routes — the work behind
// this route is not a database read, it is a billed call to an outside API, so a
// caller who is anonymous or not yet admitted must be refused before anything is
// spent on them. classifyLimiter then sits between the guards and the work,
// because an admitted caller stuck in a retry loop spends money just as fast as
// a hostile one.
//
// `requireRole('admin')` is here because this route spends MONEY, which no other
// route in this API does, and that changes who "authorised" has to mean. It was
// missing on the first cut of this feature, guarded by `requireApproved` alone,
// and a live run against the running server confirmed the consequence: a seeded
// MEMBER account got 200 from this endpoint. Nothing in the resident app calls
// it — the button exists only in the admin panel — so every member who could
// reach it was pure excess attack surface, and reaching it needs no UI at all,
// just the bearer token the app already hands out. The other two guards do not
// help here: `requireApproved` is satisfied by every ordinary resident, and the
// limiter below caps a caller, not the number of callers.
//
// No shadowing: the only other POST on this router is the literal '/', and there
// is no POST '/:id' that a request to '/classify' could fall into (verified by
// reading this file — Express matches the first layer whose path matches, so a
// '/:id' POST declared above would have taken this request).
router.post(
  '/classify',
  auth,
  requireApproved,
  requireRole('admin'),
  classifyLimiter,
  classifyMessageValidation,
  classifyMessage,
);

// Destruction is an admin act. A member deleting other people's messages is not
// a feature anyone asked for.
router.delete('/:id', auth, requireRole('admin'), deleteMessageValidation, deleteMessage);

// The endpoint that emptied the entire collection for anyone who found the URL.
router.delete('/', auth, requireRole('admin'), deleteAllMessages);

export default router;
