import express from 'express';
// authentication
// import auth from '../../../middlewares/auth.js';
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
} from '../domain/messagesController.js';

const router = express.Router();

//get messages
router.get('/', getMessagesValidation, getMessages);

//get message by id
router.get('/:id', getMessageByIdValidation, getMessageById);

//create new message
router.post('/', upload.single('file'), createMessageValidation, createMessage);

//update a message
router.patch('/:id', upload.single('file'), updateMessageValidation, updateMessage);

//delete a message
router.delete('/:id', deleteMessageValidation, deleteMessage);

export default router;
