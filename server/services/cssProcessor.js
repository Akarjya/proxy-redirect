/**
 * CSS Processor Service
 * 
 * Rewrites URLs in CSS content (url(), @import statements).
 * Handles relative URL resolution against the CSS file's location.
 */

const base64Url = require('../utils/base64Url');
const { URL } = require('url');

/**
 * Regex patterns for CSS URL patterns
 */
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const CSS_IMPORT_PATTERN = /@import\s+(['"])([^'"]+)\1/gi;
const CSS_IMPORT_URL_PATTERN = /@import\s+url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
// Pattern for protocol-relative URLs in CSS
const PROTOCOL_RELATIVE_PATTERN = /^\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}/;

/**
 * Check if URL should be skipped (not proxied)
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function shouldSkipUrl(url) {
  if (!url) return true;
  
  const trimmed = url.trim();
  
  // Don't skip protocol-relative URLs - they need to be proxied
  if (trimmed.startsWith('//')) {
    return false;
  }
  
  return (
    trimmed === '' ||
    trimmed.startsWith('data:') ||        // Data URLs
    trimmed.startsWith('#') ||            // Anchors
    trimmed.startsWith('about:') ||       // About URLs
    trimmed.startsWith('javascript:') ||  // JavaScript URLs
    trimmed.startsWith('/p/')             // Already proxied
  );
}

/**
 * Resolve a relative URL against a base URL
 * Handles protocol-relative URLs (//example.com)
 * @param {string} relativeUrl - The relative URL
 * @param {string} baseUrl - The base URL (CSS file URL)
 * @returns {string} - Absolute URL
 */
function resolveUrl(relativeUrl, baseUrl) {
  try {
    // Handle protocol-relative URLs
    if (relativeUrl && relativeUrl.startsWith('//')) {
      return 'https:' + relativeUrl;
    }
    return new URL(relativeUrl, baseUrl).href;
  } catch (e) {
    // If URL resolution fails, return original
    return relativeUrl;
  }
}

/**
 * Convert an absolute URL to a proxy URL
 * @param {string} absoluteUrl - Absolute URL
 * @returns {string} - Proxy URL (/p/{encoded})
 */
function toProxyUrl(absoluteUrl) {
  return base64Url.toProxyPath(absoluteUrl);
}

/**
 * Rewrite a single URL in CSS
 * @param {string} url - Original URL
 * @param {string} cssBaseUrl - Base URL of the CSS file
 * @returns {string} - Rewritten URL
 */
function rewriteCssUrl(url, cssBaseUrl) {
  if (shouldSkipUrl(url)) {
    return url;
  }
  
  // Resolve relative URL to absolute
  const absoluteUrl = resolveUrl(url, cssBaseUrl);
  
  // Skip if resolution failed or URL is invalid
  if (!absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
    return url;
  }
  
  // Convert to proxy URL
  return toProxyUrl(absoluteUrl);
}

/**
 * Process CSS content and rewrite all URLs
 * @param {string} css - Original CSS content
 * @param {string} cssFileUrl - URL of the CSS file (for resolving relative URLs)
 * @returns {string} - CSS with rewritten URLs
 */
function processCss(css, cssFileUrl) {
  if (!css) return css;
  
  let processed = css;
  
  // Rewrite url() patterns
  processed = processed.replace(CSS_URL_PATTERN, (match, quote, url) => {
    const rewritten = rewriteCssUrl(url, cssFileUrl);
    return `url(${quote}${rewritten}${quote})`;
  });
  
  // Rewrite @import url() patterns
  processed = processed.replace(CSS_IMPORT_URL_PATTERN, (match, quote, url) => {
    const rewritten = rewriteCssUrl(url, cssFileUrl);
    return `@import url(${quote}${rewritten}${quote})`;
  });
  
  // Rewrite @import 'url' patterns (without url())
  processed = processed.replace(CSS_IMPORT_PATTERN, (match, quote, url) => {
    const rewritten = rewriteCssUrl(url, cssFileUrl);
    return `@import ${quote}${rewritten}${quote}`;
  });
  
  return processed;
}

/**
 * Process inline style attribute value
 * @param {string} style - Inline style value
 * @param {string} pageUrl - URL of the page containing the style
 * @returns {string} - Style with rewritten URLs
 */
function processInlineStyle(style, pageUrl) {
  if (!style) return style;
  
  return style.replace(CSS_URL_PATTERN, (match, quote, url) => {
    const rewritten = rewriteCssUrl(url, pageUrl);
    return `url(${quote}${rewritten}${quote})`;
  });
}

module.exports = {
  processCss,
  processInlineStyle,
  rewriteCssUrl,
  shouldSkipUrl
};

