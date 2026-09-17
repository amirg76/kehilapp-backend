import express from 'express';
// authentication + authorization
import auth from '../../../middlewares/auth.js';
import optionalAuth from '../../../middlewares/optionalAuth.js';
import requireRole from '../../../middlewares/requireRole.js';
import requireApproved from '../../../middlewares/requireApproved.js';
// validation
import {
  getMessagesValidation,
  getMessageByIdValidation,
  createMessageValidation,
  updateMessageValidation,
  deleteMessageValidation,
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

// Destruction is an admin act. A member deleting other people's messages is not
// a feature anyone asked for.
router.delete('/:id', auth, requireRole('admin'), deleteMessageValidation, deleteMessage);

// The endpoint that emptied the entire collection for anyone who found the URL.
router.delete('/', auth, requireRole('admin'), deleteAllMessages);

export default router;
