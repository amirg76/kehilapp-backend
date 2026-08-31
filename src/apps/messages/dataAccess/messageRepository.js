import MessageModel from './messageModel.js';
import escapeRegex from './escapeRegex.js';

/** Largest page a caller may request. Stops one request from pulling the collection. */
export const MAX_PAGE_SIZE = 200;
/** Used when the caller does not ask for a specific size. */
export const DEFAULT_PAGE_SIZE = 50;

const buildQuery = (searchTerm, categoryId, includeMembers = false) => ({
  // Anonymous callers see public content only. An authenticated caller passes
  // includeMembers:true and sees both tiers. Filtering here — in the query, not
  // in memory after the fact — means members-only rows never leave the database
  // for an anonymous request, and the pagination total stays honest per tier.
  ...(includeMembers ? {} : { visibility: 'public' }),
  ...(categoryId && { categoryId }),
  ...(searchTerm && {
    $or: [
      { title: { $regex: escapeRegex(searchTerm), $options: 'i' } },
      { text: { $regex: escapeRegex(searchTerm), $options: 'i' } },
    ],
  }),
});

/**
 * Returns one page of messages plus the total, newest first.
 *
 * This used to return the whole collection on every call. That was survivable at
 * a few hundred messages and would not have been at scale — and the controller
 * signs an S3 URL per message, so an unbounded result also meant an unbounded
 * number of S3 calls per request.
 */
export const getMessagesFromDb = async (
  searchTerm,
  categoryId,
  { page = 1, limit = DEFAULT_PAGE_SIZE, includeMembers = false } = {},
) => {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const safePage = Math.max(Number(page) || 1, 1);
  const query = buildQuery(searchTerm, categoryId, includeMembers);

  const [items, total] = await Promise.all([
    MessageModel.find(query)
      .sort({ createdAt: -1 }) //sorted as created last shown first
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    MessageModel.countDocuments(query),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
};

/**
 * Fetches one message, honouring the caller's tier.
 *
 * For an anonymous caller (includeMembers:false) the visibility filter is part of
 * the query, so a members-only message simply does not match — it returns null,
 * which the controller turns into a 404. That is deliberate: a 403 would confirm
 * the message exists. Anonymous callers must not be able to tell a members-only
 * id apart from a nonexistent one.
 */
export const getMessageByIdFromDb = async (id, { includeMembers = false } = {}) => {
  const filter = includeMembers ? { _id: id } : { _id: id, visibility: 'public' };
  return await MessageModel.findOne(filter).lean();
};

/** senderId now comes from the verified token — see the controller. */
export const addMessageToDb = async (
  categoryId,
  title,
  text,
  attachmentName,
  attachmentKey,
  attachmentType,
  senderId,
) => {
  return await MessageModel.create({
    categoryId,
    title,
    text,
    attachmentName,
    attachmentKey,
    attachmentType,
    senderId,
  });
};
/**
 * Updates a message the caller is allowed to touch.
 *
 * `requesterId` and `isAdmin` scope the write: a member may edit only their own
 * message, an admin may edit any. Previously PATCH /messages/:id ran auth alone
 * and overwrote ANY message by id — a write IDOR that let any signed-in member
 * rewrite the whole board.
 *
 * `undefined` fields are stripped by Mongoose, so an update that does not touch
 * the attachment leaves the stored key intact. Returns null when nothing
 * matched, which the controller turns into a 404/403.
 */
export const updateMessageInDb = async (id, fields, { requesterId, isAdmin } = {}) => {
  const filter = isAdmin ? { _id: id } : { _id: id, senderId: requesterId };

  const update = {
    ...(fields.categoryId !== undefined && { categoryId: fields.categoryId }),
    ...(fields.title !== undefined && { title: fields.title }),
    ...(fields.text !== undefined && { text: fields.text }),
    ...(fields.attachmentName !== undefined && { attachmentName: fields.attachmentName }),
    ...(fields.attachmentKey !== undefined && { attachmentKey: fields.attachmentKey }),
    ...(fields.attachmentType !== undefined && { attachmentType: fields.attachmentType }),
  };

  return await MessageModel.findOneAndUpdate(filter, update, { new: true });
};

export const deleteMessageInDb = async (id) => {
  return await MessageModel.findByIdAndDelete(id);
};

export const deleteAllMessagesInDb = async () => {
  return await MessageModel.deleteMany({});
};
