const protectAdminRoute = (req, res, next) => {
  if (req.id && req.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin only.' });
  }
};
export default protectAdminRoute;
