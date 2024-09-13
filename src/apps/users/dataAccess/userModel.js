import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

const userSchema = new mongoose.Schema({
  // username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  // Regular user fields
  firstName: String,
  lastName: String,
  // Admin-specific fields
  adminLevel: { type: Number, default: 0 },
  adminPermissions: [String],
  lastAdminAction: Date,
});

// Apply error handling middleware
applyErrorHandlingMiddleware(userSchema);

export default mongoose.model('User', userSchema);
