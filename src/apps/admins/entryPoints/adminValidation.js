export const validateAdmin = async (req, res, next) => {
  if (req.body && req.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin rights required.' });
  }
};
