import multer from 'multer';

const storage = multer.memoryStorage();

//filter files based on type
const fileFilter = (req, file, cb) => {
  //if the file is an image, accept it
  if (file.mimetype.split('/')[0] === 'image' || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE'), false);
  }
};

// limit files for 5MB
const limits = { files: 1, fileSize: 5 * 1024 * 1024 };

const upload = multer({ storage, fileFilter, limits });

export default upload;
