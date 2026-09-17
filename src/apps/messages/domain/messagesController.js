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

/** The 403 used for a tier the caller may not ask for. */
const forbiddenError = () =>
  new AppError(
    errorManagement.commonErrors.authorizationError.message,
    errorManagement.commonErrors.authorizationError.code,
    true,
  );

/**
 * True when a non-admin explicitly asked for a tier they are not allowed to set.
 *
 * Silently normalising the request was the old behaviour, and it lied: a resident
 * using a non-browser client got a 200 while their "members only" message was
 * stored world-readable. Silence is only acceptable when the field was never
 * sent — which is the case for the resident app, whose forms never send it.
 *
 * On create an explicit 'public' passes: it is what the caller would get anyway.
 * On update ANY explicit value is refused, because honouring 'public' would
 * downgrade a members-only message the caller may not publish.
 */
const isForbiddenVisibilityRequest = (req, { onUpdate = false } = {}) => {
  if (req.role === 'admin' || req.body.visibility === undefined) {
    return false;
  }
  return onUpdate || req.body.visibility === 'members';
};

/**
 * True when the caller may READ the members-only tier.
 *
 * Signing in is no longer enough: verifying an email proves the address, not
 * membership of the community. An admin has to approve the account first, so a
 * verified-but-unapproved user sees exactly what the public sees.
 *
 * The admin bypass is deliberate and explicit: an admin created outside the seed
 * — or before this field existed — must never be locked out of their own board.
 *
 * `req.approved` comes from the user document on every request (see auth.js /
 * optionalAuth.js), not from a JWT claim, so an approval applies immediately.
 */
const canSeeMembersContent = (req) => Boolean(req.userId) && (req.approved || req.role === 'admin');

/**
 * Decides which content tier a write may land in.
 *
 * Publishing to the members-only tier is an admin act. Joi cannot make this call
 * — it never sees req.role — and the repository deliberately stays role-agnostic
 * (see the ownership comment there), so the decision belongs here, alongside the
 * existing isAdmin check in updateMessage.
 *
 * Callers run isForbiddenVisibilityRequest first, so by the time this runs a
 * non-admin has either omitted the field or sent a value that resolves to what
 * they would have got anyway — 'public' on create, no change at all on update.
 */
const resolveVisibility = (req, { onUpdate = false } = {}) => {
  if (req.role === 'admin' && (req.body.visibility === 'members' || req.body.visibility === 'public')) {
    return req.body.visibility;
  }
  return onUpdate ? undefined : 'public';
};

// get messages filtered by query and categories
export const getMessages = async (req, res, next) => {
  const { searchTerm, categoryId, page, limit } = req.query;
  // optionalAuth sets req.userId only for a valid session. An APPROVED caller
  // sees both tiers; anonymous and not-yet-approved callers see public only.
  const includeMembers = canSeeMembersContent(req);
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
  // A members-only message requested by a caller who may not see that tier does
  // not match the query and comes back null → a 404 below, which never reveals
  // its existence.
  const includeMembers = canSeeMembersContent(req);
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
export const createMessage = async (req, res, next) => {
  // Refused before the attachment is uploaded: a rejected write must not leave
  // an orphan object in the bucket.
  if (isForbiddenVisibilityRequest(req)) {
    return next(forbiddenError());
  }

  const { categoryId, title, text } = req.body;
  // Attribution comes from the verified token — never from the body, where any
  // caller could claim to be anyone. This closes the old TODO in the repository.
  const senderId = req.userId;
  const visibility = resolveVisibility(req);
  const file = req.file;

  let attachmentName, attachmentType, attachmentKey; //attachment file properties
  if (file) {
    attachmentName = file.originalname;
    attachmentType = file.mimetype;
    attachmentKey = await uploadFileToBucket('messages', file);
  }

  let message = await addMessageToDb(
    categoryId,
    title,
    text,
    attachmentName,
    attachmentKey,
    attachmentType,
    senderId,
    visibility,
  );

  if (attachmentKey) {
    message = message.toObject();
    const url = await getFileSignedURL('messages', attachmentKey);
    message.attachmentUrl = url;
  }

  res.status(200).json(message);
};

// update a message, and replace an existing file
export const updateMessage = async (req, res, next) => {
  if (isForbiddenVisibilityRequest(req, { onUpdate: true })) {
    return next(forbiddenError());
  }

  const { id } = req.params;
  const { categoryId, title, text } = req.body;
  const file = req.file;

  const fields = { categoryId, title, text };
  // undefined means "leave the stored tier alone" — the repository strips it.
  const visibility = resolveVisibility(req, { onUpdate: true });
  if (visibility !== undefined) {
    fields.visibility = visibility;
  }
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
