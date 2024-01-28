import MessageModel from './messageModel.js';

export const getMessagesFromDb = async (searchTerm, categoryId) => {
  let regexString = new RegExp(searchTerm, 'i');

  let query = {
    ...(categoryId && { categoryId: categoryId }),
    ...(searchTerm && { $or: [{ title: { $regex: regexString } }, { text: { $regex: regexString } }] }),
  };

  return await MessageModel.find(query).sort({ createdAt: -1 }); //sorted as created last shown first
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
