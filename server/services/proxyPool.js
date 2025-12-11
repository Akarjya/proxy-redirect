/**
 * Proxy Pool Service
 * 
 * Manages 922proxy SOCKS5 integration with sticky sessions.
 * Each user session gets a unique proxy session ID for consistent IP.
 */

const { SocksProxyAgent } = require('socks-proxy-agent');
const logger = require('../utils/logger');

// Load proxy configuration from environment
const config = {
  host: process.env.PROXY_HOST || 'na.proxys5.net',
  port: parseInt(process.env.PROXY_PORT) || 6200,
  protocol: process.env.PROXY_PROTOCOL || 'socks5',
  baseUser: process.env.PROXY_BASE_USER || 'Ashish',
  zone: process.env.PROXY_ZONE || 'custom',
  region: process.env.PROXY_REGION || 'US',
  sessionTime: process.env.PROXY_SESSION_TIME || '120',
  password: process.env.PROXY_PASSWORD || ''
};

/**
 * Build the dynamic proxy username for a user session
 * Format: {base_user}-zone-{zone}-region-{region}-sessid-{session_id}-sessTime-{time}
 * 
 * @param {string} userSessionId - The user's session ID
 * @returns {string} - Formatted proxy username
 */
function buildProxyUsername(userSessionId) {
  // Clean session ID - only alphanumeric characters for proxy username
  const cleanSessionId = userSessionId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  
  // Build username in 922proxy format
  const username = [
    config.baseUser,
    'zone', config.zone,
    'region', config.region,
    'sessid', cleanSessionId,
    'sessTime', config.sessionTime
  ].join('-');
  
  return username;
}

/**
 * Get proxy configuration for a user session
 * @param {string} userSessionId - The user's session ID
 * @returns {Object} - Proxy configuration object
 */
function getProxyConfig(userSessionId) {
  const username = buildProxyUsername(userSessionId);
  
  return {
    host: config.host,
    port: config.port,
    protocol: config.protocol,
    auth: {
      username: username,
      password: config.password
    }
  };
}

/**
 * Build the SOCKS5 proxy URL
 * @param {string} userSessionId - The user's session ID
 * @returns {string} - SOCKS5 URL
 */
function buildProxyUrl(userSessionId) {
  const proxyConfig = getProxyConfig(userSessionId);
  return `${proxyConfig.protocol}://${proxyConfig.auth.username}:${proxyConfig.auth.password}@${proxyConfig.host}:${proxyConfig.port}`;
}

/**
 * Create a SOCKS5 proxy agent for a user session
 * @param {string} userSessionId - The user's session ID
 * @returns {SocksProxyAgent}
 */
function createProxyAgent(userSessionId) {
  const proxyUrl = buildProxyUrl(userSessionId);
  
  logger.debug('Creating proxy agent', { 
    session: userSessionId.substring(0, 8),
    host: config.host,
    region: config.region
  });
  
  return new SocksProxyAgent(proxyUrl);
}

/**
 * Get the proxy username for logging/debugging
 * @param {string} userSessionId
 * @returns {string}
 */
function getProxyUsernameForSession(userSessionId) {
  return buildProxyUsername(userSessionId);
}

/**
 * Check if proxy is configured
 * @returns {boolean}
 */
function isProxyConfigured() {
  return !!(config.host && config.port && config.password);
}

/**
 * Get proxy info for debugging
 * @returns {Object}
 */
function getProxyInfo() {
  return {
    host: config.host,
    port: config.port,
    protocol: config.protocol,
    region: config.region,
    sessionTime: config.sessionTime,
    configured: isProxyConfigured()
  };
}

module.exports = {
  buildProxyUsername,
  getProxyConfig,
  buildProxyUrl,
  createProxyAgent,
  getProxyUsernameForSession,
  isProxyConfigured,
  getProxyInfo
};

