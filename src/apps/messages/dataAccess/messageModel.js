import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';
import { messageConstants, messageUrgencyLevels } from '../../../config/validationConstants.js';

const messageSchema = new Schema(
  {
    categoryId: { type: String, required: true },
    // The controller always sets this from the authenticated token, so a message
    // with no author can no longer be written.
    senderId: { type: String, required: true },
    title: { type: String, required: true },
    // Joi caps the body on the HTTP route; this caps it on every other write
    // path — Message.create from a script, the seed bulkWrite, a future job.
    text: { type: String, maxlength: messageConstants.textMaxLength },
    // Content tier. 'public' is readable by anyone (the showcase posture);
    // 'members' is withheld from anonymous callers entirely — never listed and
    // never revealed by direct id. Default 'public' so existing documents and any
    // create that omits the field stay visible exactly as before.
    visibility: { type: String, enum: ['public', 'members'], default: 'public' },
    // How soon a reader has to act. Default 'routine' for the same reason
    // visibility defaults to 'public': every document written before this field
    // existed has no value for it, and every create that omits it must keep
    // behaving exactly as it did — a message with no urgency is an ordinary
    // message, and reading one back must not suddenly produce undefined where
    // the client expects a level.
    urgency: { type: String, enum: messageUrgencyLevels, default: 'routine' },
    attachmentName: { type: String },
    attachmentKey: { type: String },
    attachmentType: { type: String },
  },
  { timestamps: true },
);

applyErrorHandlingMiddleware(messageSchema);

export default mongoose.model('Message', messageSchema);
