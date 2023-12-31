import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

const messageSchema = new Schema(
  {
    categoryId: { type: String, required: true },
    senderId: { type: String, required: true },
    title: { type: String, required: true },
    text: { type: String, required: true },
    attachmentPath: { type: String },
    attachmentName: { type: String },
  },
  { timestamps: true },
);

applyErrorHandlingMiddleware(messageSchema);

export default mongoose.model('Message', messageSchema);
