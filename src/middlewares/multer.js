import multer from 'multer';

const storage = multer.memoryStorage();

/**
 * Attachments an image (not SVG) or a PDF.
 *
 * SVG is excluded on purpose: it is an image that can carry <script>, and the
 * signed S3 URL serves attachments inline, so an uploaded SVG would run JS in
 * the storage origin — stored XSS. This is a coarse allowlist on the
 * client-supplied MIME; the S3 layer additionally forces a download disposition
 * so nothing is ever rendered inline regardless of type.
 */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    return cb(null, true);
  }
  return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE'), false);
};

const limits = { files: 1, fileSize: 5 * 1024 * 1024 }; // 5 MB

const upload = multer({ storage, fileFilter, limits });

export default upload;
