// DB Services
import {
  getMessagesFromDb,
  getMessageByCategoryFromDb,
  getLatestMessagesFromDb,
  getMessageByIdFromDb,
  addMessageToDb,
  updateMessageInDb,
  deleteMessageInDb,
} from '../../messages/dataAccess/messageRepository.js';
// error handlers
import AppError from '../../../errors/AppError.js';
import errorManagement from '../../../errors/utils/errorManagement.js';

// get all messages
export const getMessages = async (req, res, next) => {
  const filterBy = req.query;
  const messages = await getMessagesFromDb(filterBy);
  if (!messages) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
      ),
    );
  }

  res.status(200).json({
    status: 'success',
    data: messages,
  });
};

// get latest messages from all categories, this is to handle the Messages home page.
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

  res.status(200).json({
    status: 'success',
    data: message,
  });
};

// create a new message
export const createMessage = async (req, res) => {
  const message = await addMessageToDb(req.body);
  res.status(200).json({
    status: 'success',
    data: message,
  });
};

// update a message
export const updateMessage = async (req, res) => {
  const { id } = req.params;
  const message = await updateMessageInDb(id, req.body);
  res.status(200).json({
    status: 'success',
    data: message,
  });
};

// delete a message
export const deleteMessage = async (req, res) => {
  const { id } = req.params;
  const message = await deleteMessageInDb(id);
  res.status(200).json({
    status: 'success',
    data: message,
  });
};
