// DB Services
import {
  getMessagesFromDb,
  getMessageByIdFromDb,
  addMessageToDb,
  updateMessageInDb,
  deleteMessageInDb,
  deleteAllMessagesInDb,
} from '../../messages/dataAccess/messageRepository.js';
import {
  uploadFileToBucket,
  getFileSignedURL,
  updateFileInBucket,
  deleteFileFromBucket,
} from '../../../services/s3.js';
// error handlers
import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';

// get messages filtered by query and categories
export const getMessages = async (req, res, next) => {
  const { searchTerm, categoryId } = req.query;
  const messages = await getMessagesFromDb(searchTerm, categoryId);
  if (!messages) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  // get file signed url for all uploaded attachments
  for (const message of messages) {
    if (message.attachmentKey) {
      const url = await getFileSignedURL('messages', message.attachmentKey);
      message.attachmentUrl = url;
    }
  }

  res.status(200).json(messages);
};

// get message by id
export const getMessageById = async (req, res, next) => {
  const { id } = req.params;
  const message = await getMessageByIdFromDb(id);

  if (!message) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  if (message.attachmentKey) {
    const url = await getFileSignedURL('messages', message.attachmentKey);
    message.attachmentUrl = url;
  }

  res.status(200).json(message);
};

// create a new message
export const createMessage = async (req, res) => {
  const { categoryId, title, text } = req.body;
  const file = req.file;
  //TODO: get user id from auth token

  let attachmentName, attachmentType, attachmentKey; //attachment file properties
  if (file) {
    attachmentName = file.originalname;
    attachmentType = file.mimetype;
    attachmentKey = await uploadFileToBucket('messages', file);
  }

  let message = await addMessageToDb(categoryId, title, text, attachmentName, attachmentKey, attachmentType);

  if (attachmentKey) {
    message = message.toObject();
    const url = await getFileSignedURL('messages', attachmentKey);
    message.attachmentUrl = url;
  }

  res.status(200).json(message);
};

// update a message, and replace an existing file
export const updateMessage = async (req, res) => {
  const { id } = req.params;
  const { categoryId, title, text } = req.body;
  const file = req.file;

  let attachmentName, attachmentType, attachmentKey; //attachment file properties
  if (file) {
    attachmentName = file.originalname;
    attachmentType = file.mimetype;
  }

  let message;
  message = await updateMessageInDb(id, categoryId, title, text, attachmentName, attachmentType);

  // if there is a a file, replace it with the same name
  if (file && message.attachmentKey) {
    await updateFileInBucket('messages', message.attachmentKey, file);
  }

  res.status(200).json(message);
};

// delete a message
export const deleteMessage = async (req, res) => {
  const { id } = req.params;
  const message = await deleteMessageInDb(id);

  //if there is a file uploaded, delete it
  if (message.attachmentKey) {
    await deleteFileFromBucket('messages', message.attachmentKey);
  }

  res.status(200).send(id);
};

// delete all messages
export const deleteAllMessages = async (req, res) => {
  await deleteAllMessagesInDb();

  // //if there is a file uploaded, delete it
  // if (message.attachmentKey) {
  //   await deleteFileFromBucket('messages', message.attachmentKey);
  // }

  res.status(200).send('deleted successfully');
};
