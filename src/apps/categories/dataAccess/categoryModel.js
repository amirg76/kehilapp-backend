import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

const categorySchema = new Schema(
  {
    title: { type: String, required: true, unique: true },
    // Optional: set by the admin creating the category, not required by the API.
    managedBy: { type: String },
    icon: { type: String, required: true },
    attachmentKey: { type: String, required: true },
    categoryColor: { type: String, required: true },
  },
  { timestamps: true },
);

applyErrorHandlingMiddleware(categorySchema);

export default mongoose.model('Category', categorySchema);
