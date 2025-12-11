/**
 * Base64 URL-Safe Encoding/Decoding Utilities
 * 
 * Standard Base64 uses +, /, and = which are problematic in URLs.
 * URL-safe Base64 replaces:
 *   + with -
 *   / with _
 *   removes trailing =
 */

/**
 * Encode a string to Base64 URL-safe format
 * @param {string} str - The string to encode
 * @returns {string} - Base64 URL-safe encoded string
 */
function encode(str) {
  if (!str) return '';
  
  // Convert string to Base64
  const base64 = Buffer.from(str, 'utf-8').toString('base64');
  
  // Make it URL-safe:
  // Replace + with -
  // Replace / with _
  // Remove trailing =
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a Base64 URL-safe encoded string
 * @param {string} encoded - The Base64 URL-safe encoded string
 * @returns {string} - Decoded string
 */
function decode(encoded) {
  if (!encoded) return '';
  
  // Restore Base64 format:
  // Replace - with +
  // Replace _ with /
  let base64 = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  // Add padding if needed (Base64 length must be multiple of 4)
  const padding = base64.length % 4;
  if (padding) {
    base64 += '='.repeat(4 - padding);
  }
  
  // Decode Base64 to string
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Convert a URL to a proxy URL path
 * @param {string} url - Original URL
 * @returns {string} - Proxy path (/p/{encoded})
 */
function toProxyPath(url) {
  return '/p/' + encode(url);
}

/**
 * Extract and decode URL from proxy path
 * @param {string} proxyPath - The proxy path (/p/{encoded} or just {encoded})
 * @returns {string} - Original URL
 */
function fromProxyPath(proxyPath) {
  // Remove /p/ prefix if present
  const encoded = proxyPath.replace(/^\/p\//, '');
  return decode(encoded);
}

/**
 * Check if a path is a proxy path
 * @param {string} path - The path to check
 * @returns {boolean}
 */
function isProxyPath(path) {
  return path && path.startsWith('/p/');
}

module.exports = {
  encode,
  decode,
  toProxyPath,
  fromProxyPath,
  isProxyPath
};

