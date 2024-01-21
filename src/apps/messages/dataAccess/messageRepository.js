import MessageModel from './messageModel.js';

// TODO: filtering dynamically by field - mongo aggregation framework
export const getMessagesFromDb = async (filterBy) => {
  console.log('get from db', filterBy);
  if (filterBy.latest === true) {
    console.log('latest');
    return await MessageModel.find({}).sort({ createdAt: -1 }).limit(5);
  }
  const query = {}
  if (filterBy.categoryId && !filterBy.searchTerm) {
    console.log('category');
    query.categoryId = filterBy.categoryId
  } else if (filterBy.searchTerm && !filterBy.categoryId) {
    console.log('search');
    const stringRegex = new RegExp(filterBy.searchTerm, 'i');
    query.$or = [
      { title: { $regex: stringRegex } },
      { text: { $regex: stringRegex } },
    ];
  } else if (filterBy.categoryId && filterBy.searchTerm) {
    console.log('search & category');
    query.$and = [
      { categoryId: query.categoryId },
      {
        $or: [
          { title: { $regex: new RegExp(query.searchTerm, 'i') } },
          { text: { $regex: new RegExp(query.searchTerm, 'i') } },
        ],
      },
    ]
  }
  return await MessageModel.find(query).sort({ createdAt: -1 }); //sorted as created last shown first
};

export const getMessageByCategoryFromDb = async (categoryId) => {
  return await MessageModel.find({ categoryId }).sort({ createdAt: -1 });
};

//TODO: change logic to fit the "ראשי" category, currently return the 5 newest messages
export const getLatestMessagesFromDb = async () => {
  return await MessageModel.find({}).sort({ createdAt: -1 }).limit(5);
};

export const gettMessagesByQueryFromDb = async (stringRegex) => {
  const query = {
    $or: [{ title: { $regex: stringRegex } }, { text: { $regex: stringRegex } }],
  };
  return await MessageModel.find(query).sort({ createdAt: -1 }).limit(5);
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
