// DB Services
import {
  getMessagesFromDb,
  getMessageByIdFromDb,
  addMessageToDb,
  updateMessageInDb,
  deleteMessageInDb,
  getMessageByCategoryFromDb,
  getGeneralMessagesFromDb,
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

export const getMessageByCategory = async (req, res, next) => {
  const { id } = req.params;
  let messages;
  if (id === 'all') {
    messages = await getGeneralMessagesFromDb(id);
  } else {
    messages = await getMessageByCategoryFromDb(id);
  }
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
