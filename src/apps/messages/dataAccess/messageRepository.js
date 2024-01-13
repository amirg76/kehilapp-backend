import MessageModel from './messageModel.js';

export const getMessagesFromDb = async () => {
  return await MessageModel.find({}).sort({ createdAt: -1 }).lean(); //sorted as created last shown first
};

export const getMessageByCategoryFromDb = async (categoryId) => {
  return await MessageModel.find({ categoryId }).sort({ createdAt: -1 }).lean();
};

//TODO: change logic to fit the "ראשי" category, currently return the 5 newest messages
export const getLatestMessagesFromDb = async () => {
  return await MessageModel.find({}).sort({ createdAt: -1 }).limit(5).lean();
};

export const getMessagesByQueryFromDb = async (stringRegex) => {
  const query = {
    $or: [{ title: { $regex: stringRegex } }, { text: { $regex: stringRegex } }],
  };
  return await MessageModel.find(query).sort({ createdAt: -1 }).limit(5).lean();
};

export const getMessageByIdFromDb = async (id) => {
  return await MessageModel.findById(id).lean();
};

//TODO: get user id from auth token and add to db
export const addMessageToDb = async (categoryId, title, text, attachmentName, attachmentKey, attachmentType) => {
  return await MessageModel.create({ categoryId, title, text, attachmentName, attachmentKey, attachmentType });
};

export const updateMessageInDb = async (id, categoryId, title, text, attachmentName, attachmentKey, attachmentType) => {
  return await MessageModel.findByIdAndUpdate(
    id,
    { categoryId, title, text, attachmentName, attachmentKey, attachmentType },
    { new: true },
  );
};

export const deleteMessageInDb = async (id) => {
  return await MessageModel.findByIdAndDelete(id);
};
