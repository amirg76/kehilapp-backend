import { createServer } from 'http';
import 'dotenv/config';
// import { config } from 'dotenv-flow'; //! replaced with regular dotenv library, bug fix
import { connectDB } from './services/db.js';
import app from './app.js';
import AppError from './errors/AppError.js';
import errorManagement from './errors/utils/errorManagement.js';

// config({ path: './config/' }); //! replaced with regular dotenv library, bug fix
connectDB()
  .then(() => console.log('DB connected!'))
  .catch(() => {
    throw new AppError(
      errorManagement.commonErrors.databaseError.message,
      errorManagement.commonErrors.databaseError.code,
      true,
    );
  });
const httpServer = createServer(app);
httpServer.listen(process.env.PORT || 5001, () => {
  if (process.env.NODE_ENV === 'local') {
    console.log('Node running on Local mode ...');
  } else if (process.env.NODE_ENV === 'dev') {
    console.log('Node running on Development mode...');
    console.log(`server running on port: ${process.env.PORT}`);
  } else if (process.env.NODE_ENV === 'production') {
    console.log('Node running on production mode...');
  }
});
