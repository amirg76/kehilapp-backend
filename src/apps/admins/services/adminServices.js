import XLSX from 'xlsx';
import Counter from '../../users/dataAccess/counterModel.js';
import userModel from '../../users/dataAccess/userModel.js';
export const readExcelFile = (file) => {
  const workbook = XLSX.readFile(file.path);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet);
  return data;
};
export const restSequence = async () => {
  await Counter.updateOne({ _id: 'userId' }, { $set: { seq: 0 } });
};

export const addSequenceId = async (data, type = 'users') => {
  if (Array.isArray(data)) {
    // data is an array of users
    const usersWithIds = await addSequenceIdsToUsersArray(data);
    return usersWithIds;
  } else {
    // data is a single user object
    const userWithId = await addSequenceIdToUser(data);
    return userWithId;
  }
};

const addSequenceIdsToUsersArray = async (users) => {
  const maxUser = await userModel.findOne({}, { id: 1 }, { sort: { id: -1 } });

  let sequence = maxUser ? maxUser.id : 0;

  // Retrieve the current sequence value from the counters collection
  const counter = await Counter.findByIdAndUpdate({ _id: 'userId' }, { $inc: { seq: 1 } }, { new: true, upsert: true });

  sequence += counter.seq;
  const usersWithIds = users.map((user) => ({ ...user, id: sequence++ }));
  return usersWithIds;
};

const addSequenceIdToUser = async (user) => {
  const maxUser = await userModel.findOne({}, { id: 1 }, { sort: { id: -1 } });
  let sequence = maxUser ? maxUser.id : 0;

  const counter = await Counter.findByIdAndUpdate({ _id: 'userId' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  sequence++;

  return { ...user, id: sequence };
};
