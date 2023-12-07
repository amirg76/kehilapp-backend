import { createServer } from 'http';
import { config } from 'dotenv-flow';
import { connectDB } from './services/db.js';
import app from './app.js';
import AppError from './errors/AppError.js';
import logger from './services/logger.js';

config({ path: 'src/config/' });
connectDB()
  .then(() => console.log('DB connected!'))
  .catch(() => {
    throw new AppError('Database connection error', 500, true);
  });
const httpServer = createServer(app);
httpServer.listen(process.env.PORT || 5000, () => {
  if (process.env.NODE_ENV === 'local') {
    console.log('Node running on Local mode ...');
  } else if (process.env.NODE_ENV === 'dev') {
    console.log('Node running on Development mode...');
    console.log(`server running on port: ${process.env.PORT}`);
    logger.info('INFO TEST');
    logger.warn('WARN TEST');
    logger.error('ERROR TEST');
  } else if (process.env.NODE_ENV === 'production') {
    console.log('Node running on production mode...');
  }
});
