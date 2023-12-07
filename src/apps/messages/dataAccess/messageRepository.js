import MessageModel from './messageModel.js';

// TODO: filtering dynamically by field - mongo aggregation framework
export const getMessagesFromDb = async (filterBy) => {
  return await MessageModel.find(filterBy).sort({ createdAt: -1 }); //sorted as created last shown first
};

export const getMessageByIdFromDb = async (id) => {
  return await MessageModel.findById(id);
};

export const addMessageToDb = async (message) => {
  return await MessageModel.create(message);
};

export const updateMessageInDb = async (id, updatedMessage) => {
  return await MessageModel.findByIdAndUpdate(id, updatedMessage, { new: true });
};

export const deleteMessageInDb = async (id) => {
  return await MessageModel.findByIdAndDelete(id);
};
