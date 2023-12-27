import express from 'express';
// authentication
// import auth from '../../../middlewares/auth.js';
// validation
import {
  getMessageByIdValidation,
  createMessageValidation,
  updateMessageValidation,
  deleteMessageValidation,
} from './messagesValidation.js';
// controllers
import {
  getMessages,
  getMessageById,
  getMessageByCategory,
  createMessage,
  updateMessage,
  deleteMessage,
} from '../domain/messagesController.js';

const router = express.Router();

//get all messages
router.get(
  '/',
  // auth,
  getMessages,
);

//get message by id
router.get(
  '/:id',
  getMessageByIdValidation,
  // auth,
  getMessageById,
);

//get messages by category
router.get('/category/:id', getMessageByCategory);

//create new message
router.post(
  '/',
  createMessageValidation,
  // auth,
  createMessage,
);

//update a message
router.patch(
  '/:id',
  updateMessageValidation,
  // auth,
  updateMessage,
);

//delete a message
router.delete(
  '/:id',
  deleteMessageValidation,
  // auth,
  deleteMessage,
);

export default router;
