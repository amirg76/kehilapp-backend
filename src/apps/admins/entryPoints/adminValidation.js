import AppError from '../../../errors/AppError.js';
import User from '../../users/dataAccess/userModel.js';

export const validateAdmin = async (req, res, next) => {
  // const user = await User.findOne({ email: req.body.email });

  // if (user && user.role === 'admin') {
  //   next();
  // } else {
  //   // next(new AppError('Admin Rights', 403));
  //   const err = new AppError('Admin Rights', 403);
  //   return next(err);
  //   // res.status(403).json({ message: 'Access denied. Admin rights required.' });
  // }
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user || user.role !== 'admin') {
      throw new AppError('Access denied. Admin rights required.', 403);
    }
    // If the user is an admin, attach the user object to the request
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
