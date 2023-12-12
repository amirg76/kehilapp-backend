import winston from 'winston';
// import colors from 'colors';
// import { fileURLToPath } from 'url';
// import { dirname, join } from 'path';

const { createLogger, format, transports } = winston;
const { combine, timestamp, label, printf } = format;

// Get the directory name of the current module
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// Define log format

//possible to add the label in the variable destructuring
const logFormat = printf(({ level, message, timestamp }) => {
    const formattedTimestamp = new Date(timestamp).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric'
        // hour12: true,

    });

    const formattedMessage = `${formattedTimestamp} - ${level.toUpperCase()} - ${message}`;

    // Add colors based on log level
    // switch (level) {
    //     case 'info':
    //         return colors.green(formattedMessage);
    //     case 'warn':
    //         return colors.yellow(formattedMessage);
    //     case 'error':
    //         return colors.red(formattedMessage);
    //     default:
    //         return formattedMessage;
    // }

    return formattedMessage
});

// Define the path for the log file
// const logFilePath = join(__dirname, 'logs', 'logfile.log');

// Create the logger
const logger = createLogger({
    format: combine(
        // label({ label: 'kibbutz-website' }),
        timestamp(),
        logFormat
    ),
    // format: winston.format.json(),
    transports: [
        // new transports.Console(),
        // new transports.File({ filename: logFilePath })
        new transports.File({ filename: './src/logs/logfile.log' })

    ]
});

// Export the logger
export default logger;