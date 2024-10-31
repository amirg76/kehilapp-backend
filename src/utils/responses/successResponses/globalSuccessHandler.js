// import logger from '../../../services/logger.js';

// export const successHandler = (res, appSuccess) => {
//   // Get user email from the request if available
//   const userEmail = res.locals.userEmail || 'unknown'; // You'll need to set this in your login controller
//   // Log successful operation
//   logger.info(
//     `${appSuccess.statusCode} - ${appSuccess.message}  - ${userEmail}- ${res.req.originalUrl} - ${res.req.ip} - ${res.req.method}`,
//   );

//   // Send standardized success response
//   return res.status(200).json({
//     success: true,
//     data: appSuccess.data,
//     message: appSuccess.message,
//   });
// };
import logger from '../../../services/logger.js';

// Utility function to mask sensitive data
const maskEmail = (email) => {
  if (!email) return 'unknown';
  const [name, domain] = email.split('@');
  return `${name.charAt(0)}${new Array(name.length).join('*')}@${domain}`;
};

// Utility function to format timestamp
const getFormattedTimestamp = () => {
  return new Date().toISOString();
};

// Utility function to get user agent info
const getUserAgentInfo = (req) => {
  const userAgent = req.headers['user-agent'] || 'unknown';
  return userAgent;
};

// Utility function to get request details
const getRequestDetails = (req) => {
  return {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: getUserAgentInfo(req),
    referrer: req.headers.referer || req.headers.referrer || 'direct',
  };
};

export const successHandler = (res, appSuccess) => {
  const timestamp = getFormattedTimestamp();
  const requestDetails = getRequestDetails(res.req);

  // Get user info from res.locals
  const userEmail = res.locals.userEmail || 'unknown';
  const userId = res.locals.userId || 'unknown';
  const userRole = res.locals.userRole || 'unknown';

  // Create structured log entry
  const logEntry = {
    timestamp,
    level: 'INFO',
    event: appSuccess.message,
    status: appSuccess.statusCode,
    user: {
      id: userId,
      email: maskEmail(userEmail),
      role: userRole,
    },
    request: {
      method: requestDetails.method,
      path: requestDetails.url,
      ip: requestDetails.ip,
      userAgent: requestDetails.userAgent,
      referrer: requestDetails.referrer,
    },
    sessionId: res.locals.sessionId || 'unknown',
    duration: res.locals.requestDuration || 0,
  };

  // Log in JSON format for better parsing
  logger.info(JSON.stringify(logEntry));

  // Also log in human-readable format for quick debugging
  logger.info(
    `[${timestamp}] ${logEntry.status} ${logEntry.event} - User: ${logEntry.user.email} - ${logEntry.request.method} ${logEntry.request.path} - IP: ${logEntry.request.ip}`,
  );

  // Send standardized success response
  return res.status(200).json({
    success: true,
    data: appSuccess.data,
    message: appSuccess.message,
  });
};
