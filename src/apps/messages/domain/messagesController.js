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
  const { searchTerm, categoryId, page, limit } = req.query;
  // optionalAuth sets req.userId only for a valid session. A signed-in caller
  // sees both tiers; an anonymous one sees public content only.
  const includeMembers = Boolean(req.userId);
  const {
    items: messages,
    total,
    page: currentPage,
    limit: pageSize,
  } = await getMessagesFromDb(searchTerm, categoryId, { page, limit, includeMembers });
  if (!messages) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  // Sign attachment URLs concurrently — sequential awaits made response time
  // grow linearly with the number of attachments on the page.
  await Promise.all(
    messages.map(async (message) => {
      if (message.attachmentKey) {
        message.attachmentUrl = await getFileSignedURL('messages', message.attachmentKey);
      }
    }),
  );

  // Body stays the plain array so existing clients keep working; pagination
  // metadata rides in headers.
  res.set('X-Total-Count', String(total));
  res.set('X-Page', String(currentPage));
  res.set('X-Page-Size', String(pageSize));
  res.status(200).json(messages);
};

// get message by id
export const getMessageById = async (req, res, next) => {
  const { id } = req.params;
  // A members-only message requested by an anonymous caller does not match the
  // query and comes back null → a 404 below, which never reveals its existence.
  const includeMembers = Boolean(req.userId);
  const message = await getMessageByIdFromDb(id, { includeMembers });

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
  // Attribution comes from the verified token — never from the body, where any
  // caller could claim to be anyone. This closes the old TODO in the repository.
  const senderId = req.userId;
  const file = req.file;
  //TODO: get user id from auth token

  let attachmentName, attachmentType, attachmentKey; //attachment file properties
  if (file) {
    attachmentName = file.originalname;
    attachmentType = file.mimetype;
    attachmentKey = await uploadFileToBucket('messages', file);
  }

  let message = await addMessageToDb(categoryId, title, text, attachmentName, attachmentKey, attachmentType, senderId);

  if (attachmentKey) {
    message = message.toObject();
    const url = await getFileSignedURL('messages', attachmentKey);
    message.attachmentUrl = url;
  }

  res.status(200).json(message);
};

// update a message, and replace an existing file
export const updateMessage = async (req, res, next) => {
  const { id } = req.params;
  const { categoryId, title, text } = req.body;
  const file = req.file;

  const fields = { categoryId, title, text };
  if (file) {
    fields.attachmentName = file.originalname;
    fields.attachmentType = file.mimetype;
    // attachmentKey is deliberately left untouched: the existing S3 object is
    // overwritten in place below, so its key does not change.
  }

  // Ownership is enforced in the repository: a member may edit only their own
  // message, an admin any. A null result means "not yours, or does not exist".
  const message = await updateMessageInDb(id, fields, {
    requesterId: req.userId,
    isAdmin: req.role === 'admin',
  });

  if (!message) {
    return next(
      new AppError(
        errorManagement.commonErrors.resourceNotFound.message,
        errorManagement.commonErrors.resourceNotFound.code,
        true,
      ),
    );
  }

  // Replace the file contents under the message's existing key.
  if (file && message.attachmentKey) {
    await updateFileInBucket('messages', message.attachmentKey, file);
  }

  return res.status(200).json(message);
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
