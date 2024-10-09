import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

// Apply error handling middleware
applyErrorHandlingMiddleware(counterSchema);

export default mongoose.model('Counter', counterSchema);
