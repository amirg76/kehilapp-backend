import { applyErrorHandlingMiddleware } from '../../../errors/utils/dbErrorHandling.js';
import mongoose, { Schema } from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    // id: { type: Number, unique: true, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    // Regular user fields
    firstName: { type: String },
    lastName: { type: String },
    phone: { type: String },
    img: { type: String, default: '' },
    // Admin-specific fields
    adminLevel: { type: Number, default: 0 },
    adminPermissions: [String],
    lastAdminAction: Date,
    verified: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Apply error handling middleware
applyErrorHandlingMiddleware(userSchema);

export default mongoose.model('User', userSchema);
