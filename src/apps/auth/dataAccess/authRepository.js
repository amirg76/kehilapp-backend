//TODO
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../../../config/env.js';
export const generateToken = async (user) => {
  const accessToken = jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    getJwtSecret(),
    { expiresIn: '15m' },
  );

  return accessToken;
};
