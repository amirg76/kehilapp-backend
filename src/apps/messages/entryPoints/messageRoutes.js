import express from 'express';
// authentication
// import auth from '../../../middlewares/auth.js';
// validation
// import {
//   getMessageByIdValidation,
//   getMessagesByCategoriesValidation,
//   createMessageValidation,
//   updateMessageValidation,
//   deleteMessageValidation,
// } from './messagesValidation.js';
//upload middleware
import upload from '../../../middlewares/multer.js';
// controllers
import {
  getMessages,
  getMessageById,
  getMessageByCategory,
  getLatestMessages,
  getMessagesByQuery,
  createMessage,
  updateMessage,
  deleteMessage,
} from '../domain/messagesController.js';

const router = express.Router();

//get all messages
router.get('/', getMessages);

// get newest messages -
router.get('/latest', getLatestMessages);

// get messages by query -
router.get('/search', getMessagesByQuery);

//get messages by category
router.get('/category/:id', getMessageByCategory);

//get message by id
router.get('/:id', getMessageById);

//create new message
router.post('/', createMessage);

//update a message
router.patch('/:id', updateMessage);

//delete a message
router.delete('/:id', deleteMessage);

export default router;
