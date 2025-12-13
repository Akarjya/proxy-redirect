/**
 * URL Shortener Service
 * 
 * Stores long URLs with short hashes to bypass URL length limits.
 * Google Ads tracking URLs can be 10,000+ characters which exceeds
 * browser URL path limits (~2000 chars).
 * 
 * Solution: Store long URL server-side, use short hash in path.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// In-memory URL store (use Redis in production for persistence)
const urlStore = new Map();

// URL TTL in milliseconds (1 hour - enough for ad click flow)
const URL_TTL = 60 * 60 * 1000;

// Max URL length before shortening is required
const MAX_PATH_LENGTH = 1500; // Safe limit for URL paths

/**
 * Generate a short hash for a URL
 * @param {string} url - Full URL to hash
 * @returns {string} - 12 character hash
 */
function generateHash(url) {
  return crypto.createHash('md5')
    .update(url + Date.now().toString())
    .digest('base64url')
    .substring(0, 12);
}

/**
 * Check if URL needs shortening
 * @param {string} encodedUrl - Base64 encoded URL
 * @returns {boolean}
 */
function needsShortening(encodedUrl) {
  return encodedUrl && encodedUrl.length > MAX_PATH_LENGTH;
}

/**
 * Store a long URL and return short hash
 * @param {string} fullUrl - Full URL (not encoded)
 * @returns {string} - Short hash ID
 */
function storeUrl(fullUrl) {
  // Check if already stored (avoid duplicates)
  for (const [hash, data] of urlStore.entries()) {
    if (data.url === fullUrl && !isExpired(data)) {
      // Refresh TTL
      data.timestamp = Date.now();
      logger.debug('URL already stored, returning existing hash', { hash });
      return hash;
    }
  }
  
  // Generate new hash
  const hash = generateHash(fullUrl);
  
  // Store with timestamp
  urlStore.set(hash, {
    url: fullUrl,
    timestamp: Date.now()
  });
  
  logger.info('Long URL stored', { 
    hash, 
    urlLength: fullUrl.length,
    urlPreview: fullUrl.substring(0, 60) + '...'
  });
  
  return hash;
}

/**
 * Retrieve full URL from hash
 * @param {string} hash - Short hash
 * @returns {string|null} - Full URL or null if not found/expired
 */
function getUrl(hash) {
  const data = urlStore.get(hash);
  
  if (!data) {
    logger.warn('URL hash not found', { hash });
    return null;
  }
  
  if (isExpired(data)) {
    urlStore.delete(hash);
    logger.warn('URL hash expired', { hash });
    return null;
  }
  
  // Refresh TTL on access
  data.timestamp = Date.now();
  
  logger.debug('URL retrieved from hash', { 
    hash, 
    urlLength: data.url.length 
  });
  
  return data.url;
}

/**
 * Check if URL data is expired
 * @param {Object} data - URL data object
 * @returns {boolean}
 */
function isExpired(data) {
  return Date.now() - data.timestamp > URL_TTL;
}

/**
 * Clean up expired URLs
 */
function cleanup() {
  let cleaned = 0;
  
  for (const [hash, data] of urlStore.entries()) {
    if (isExpired(data)) {
      urlStore.delete(hash);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug('Cleaned up expired URLs', { count: cleaned });
  }
}

// Run cleanup every 10 minutes
setInterval(cleanup, 10 * 60 * 1000);

/**
 * Get store stats (for debugging)
 */
function getStats() {
  return {
    totalUrls: urlStore.size,
    maxPathLength: MAX_PATH_LENGTH,
    ttlMinutes: URL_TTL / 60000
  };
}

module.exports = {
  storeUrl,
  getUrl,
  needsShortening,
  getStats,
  MAX_PATH_LENGTH
};

