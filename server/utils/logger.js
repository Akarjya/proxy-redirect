/**
 * Simple logging utility for the proxy server
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const currentLevel = process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;

function formatTimestamp() {
  return new Date().toISOString();
}

function formatMessage(level, message, data) {
  const timestamp = formatTimestamp();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level}] ${message}${dataStr}`;
}

const logger = {
  debug(message, data = null) {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
      console.log(formatMessage('DEBUG', message, data));
    }
  },

  info(message, data = null) {
    if (currentLevel <= LOG_LEVELS.INFO) {
      console.log(formatMessage('INFO', message, data));
    }
  },

  warn(message, data = null) {
    if (currentLevel <= LOG_LEVELS.WARN) {
      console.warn(formatMessage('WARN', message, data));
    }
  },

  error(message, data = null) {
    if (currentLevel <= LOG_LEVELS.ERROR) {
      console.error(formatMessage('ERROR', message, data));
    }
  },

  // Log proxy request
  proxyRequest(method, targetUrl, sessionId) {
    this.info(`PROXY ${method}`, { url: targetUrl, session: sessionId?.substring(0, 8) + '...' });
  },

  // Log response info
  proxyResponse(targetUrl, status, contentType) {
    this.debug(`RESPONSE`, { url: targetUrl?.substring(0, 50), status, type: contentType });
  }
};

module.exports = logger;

