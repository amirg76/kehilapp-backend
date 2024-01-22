// DB Services
import {
  getMessagesFromDb,
  getMessageByCategoryFromDb,
  getLatestMessagesFromDb,
  getMessageByIdFromDb,
  getMessagesByQueryFromDb,
  addMessageToDb,
  updateMessageInDb,
  deleteMessageInDb,
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
import { log } from 'console';

// get all messages
export const getMessages = async (req, res, next) => {
  const messages = await getMessagesFromDb();

  if (!messages) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  // get file signed url for all uploaded attachments
  for (const message of messages) {
    if (message.attachmentKey) {
      const url = await getFileSignedURL(message.attachmentKey);
      message.attachmentUrl = url;
    }
  }

  res.status(200).json({
    status: 'success',
    data: messages,
  });
};

// get all messages of a specific category
export const getMessageByCategory = async (req, res, next) => {
  const { id } = req.params;
  const messages = await getMessageByCategoryFromDb(id);
  if (!messages) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  // get file signed url for all uploaded attachments
  for (const message of messages) {
    if (message.attachmentKey) {
      const url = await getFileSignedURL(message.attachmentKey);
      message.attachmentUrl = url;
    }
  }

  res.status(200).json({
    status: 'success',
    data: messages,
  });
};

// get latest messages from all categories
export const getLatestMessages = async (req, res, next) => {
  const messages = await getLatestMessagesFromDb();
  if (!messages) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  // get file signed url for all uploaded attachments
  for (const message of messages) {
    if (message.attachmentKey) {
      const url = await getFileSignedURL(message.attachmentKey);
      message.attachmentUrl = url;
    }
  }

  res.status(200).json({
    status: 'success',
    data: messages,
  });
};

// get latest messages from all categories, this is to handle the Messages home page.
export const getMessagesByQuery = async (req, res, next) => {
  const searchString = req.query.searchTerm;
  const stringRegex = new RegExp(searchString, 'i');
  const messages = await getMessagesByQueryFromDb(stringRegex);

  if (!messages) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  // get file signed url for all uploaded attachments
  for (const message of messages) {
    if (message.attachmentKey) {
      const url = await getFileSignedURL(message.attachmentKey);
      message.attachmentUrl = url;
    }
  }

  res.status(200).json({
    status: 'success',
    data: messages,
  });
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
    const url = await getFileSignedURL(message.attachmentKey);
    message.attachmentUrl = url;
  }

  res.status(200).json({
    status: 'success',
    data: message,
  });
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
    attachmentKey = await uploadFileToBucket(file);
  }

  const message = await addMessageToDb(categoryId, title, text, attachmentName, attachmentKey, attachmentType);

  res.status(200).json({
    status: 'success',
    data: message,
  });
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
    await updateFileInBucket(file, message.attachmentKey);
  }

  res.status(200).json({
    status: 'success',
    data: message,
  });
};

// delete a message
export const deleteMessage = async (req, res) => {
  const { id } = req.params;
  const message = await deleteMessageInDb(id);

  //if there is a file uploaded, delete it
  if (message.attachmentKey) {
    await deleteFileFromBucket(message.attachmentKey);
  }

  res.status(200).json({
    status: 'success',
    data: message,
  });
};
