/**
 * URL Validation Utility
 * Prevents SSRF (Server-Side Request Forgery) attacks
 */

const { URL } = require('url');
const dns = require('dns').promises;

// Private IP ranges to block
const PRIVATE_IP_RANGES = [
  /^127\./, // Localhost
  /^10\./, // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
  /^192\.168\./, // Private Class C
  /^169\.254\./, // Link-local
  /^0\./, // Current network
  /^::1$/, // IPv6 localhost
  /^fc00:/, // IPv6 private
  /^fe80:/, // IPv6 link-local
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.internal',
  '169.254.169.254', // AWS/GCP metadata
];

/**
 * Check if an IP address is private/internal
 * @param {string} ip - IP address to check
 * @returns {boolean}
 */
function isPrivateIP(ip) {
  return PRIVATE_IP_RANGES.some(pattern => pattern.test(ip));
}

/**
 * Check if hostname is blocked
 * @param {string} hostname - Hostname to check
 * @returns {boolean}
 */
function isBlockedHostname(hostname) {
  const lower = hostname.toLowerCase();
  return BLOCKED_HOSTNAMES.some(blocked => lower === blocked || lower.endsWith('.' + blocked));
}

/**
 * Validate a URL for safe proxying
 * @param {string} urlString - URL to validate
 * @returns {Promise<{valid: boolean, error?: string, url?: URL}>}
 */
async function validateUrl(urlString) {
  try {
    // Parse URL
    const url = new URL(urlString);

    // Check protocol (only http/https allowed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        valid: false,
        error: `Invalid protocol: ${url.protocol}. Only http/https allowed.`
      };
    }

    // Check for blocked hostnames
    if (isBlockedHostname(url.hostname)) {
      return {
        valid: false,
        error: `Blocked hostname: ${url.hostname}`
      };
    }

    // Check if hostname is an IP address
    if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) {
      if (isPrivateIP(url.hostname)) {
        return {
          valid: false,
          error: `Private IP not allowed: ${url.hostname}`
        };
      }
    } else {
      // Resolve hostname to check for DNS rebinding attacks
      try {
        const addresses = await dns.lookup(url.hostname, { all: true });
        
        for (const addr of addresses) {
          if (isPrivateIP(addr.address)) {
            return {
              valid: false,
              error: `Hostname ${url.hostname} resolves to private IP: ${addr.address}`
            };
          }
        }
      } catch (dnsError) {
        // DNS resolution failed - might be invalid hostname
        // For POC, we'll allow it and let the fetch fail
        // In production, you might want to block this
      }
    }

    return {
      valid: true,
      url
    };

  } catch (error) {
    return {
      valid: false,
      error: `Invalid URL: ${error.message}`
    };
  }
}

/**
 * Quick validation without DNS lookup (faster but less secure)
 * @param {string} urlString - URL to validate
 * @returns {{valid: boolean, error?: string, url?: URL}}
 */
function validateUrlSync(urlString) {
  try {
    const url = new URL(urlString);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, error: `Invalid protocol: ${url.protocol}` };
    }

    if (isBlockedHostname(url.hostname)) {
      return { valid: false, error: `Blocked hostname: ${url.hostname}` };
    }

    if (/^[\d.]+$/.test(url.hostname) && isPrivateIP(url.hostname)) {
      return { valid: false, error: `Private IP not allowed: ${url.hostname}` };
    }

    return { valid: true, url };

  } catch (error) {
    return { valid: false, error: `Invalid URL: ${error.message}` };
  }
}

module.exports = {
  validateUrl,
  validateUrlSync,
  isPrivateIP,
  isBlockedHostname
};

