import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

//TODO: Indexing, commented required should be handled by backend and not received from request
const categorySchema = new Schema(
  {
    title: { type: String, required: true, unique: true },
    managedBy: { type: String }, //required: true
    icon: { type: String, required: true },
    attachmentKey: { type: String, required: true },
    categoryColor: { type: String, required: true },
  },
  { timestamps: true },
);

applyErrorHandlingMiddleware(categorySchema);

export default mongoose.model('Category', categorySchema);
