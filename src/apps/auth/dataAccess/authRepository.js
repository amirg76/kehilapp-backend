//TODO
import jwt from 'jsonwebtoken';
export const generateToken = async (user) => {
  const accessToken = jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    // { expiresIn: "900s" }
  );

  return accessToken;
};
