import logger from '../services/logger.js';

export const successHandler = (res, appSuccess) => {
  // Log successful operation
  logger.info(
    `${appSuccess.statusCode} - ${appSuccess.message} - ${res.req.originalUrl} - ${res.req.ip} - ${res.req.method}`,
  );

  // Send standardized success response
  return res.status(200).json({
    success: true,
    data: appSuccess.data,
    message: appSuccess.message,
  });
};
