import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

//TODO ??
const authSchema = new Schema({
  // exampleId: { required: true, type: String, default: 'exampleId' },
  // name: { required: true, type: String, default: 'Example name' },
});

applyErrorHandlingMiddleware(authSchema);

export default mongoose.model('Auth', authSchema);
