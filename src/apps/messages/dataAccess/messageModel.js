import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

const messageSchema = new Schema(
  {
    categoryId: { type: String, required: true },
    // The controller always sets this from the authenticated token, so a message
    // with no author can no longer be written.
    senderId: { type: String, required: true },
    title: { type: String, required: true },
    text: { type: String },
    // Content tier. 'public' is readable by anyone (the showcase posture);
    // 'members' is withheld from anonymous callers entirely — never listed and
    // never revealed by direct id. Default 'public' so existing documents and any
    // create that omits the field stay visible exactly as before.
    visibility: { type: String, enum: ['public', 'members'], default: 'public' },
    attachmentName: { type: String },
    attachmentKey: { type: String },
    attachmentType: { type: String },
  },
  { timestamps: true },
);

applyErrorHandlingMiddleware(messageSchema);

export default mongoose.model('Message', messageSchema);
