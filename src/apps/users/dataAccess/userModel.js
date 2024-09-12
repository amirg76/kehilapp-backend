import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  passport: { type: String },
});
// const userSchema = new Schema({
//   email: { type: String, required: true, unique: true },
//   password: { type: String, required: true },
// });

applyErrorHandlingMiddleware(userSchema);

export default mongoose.model('User', userSchema);
