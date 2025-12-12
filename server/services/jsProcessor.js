/**
 * JavaScript Processor Service
 * 
 * Rewrites URLs in JavaScript content to route through the proxy.
 * Handles string literals, template literals, and common URL patterns.
 * 
 * IMPORTANT: This is a best-effort processor since JS is dynamic.
 * Service Worker remains the primary interception mechanism.
 */

const base64Url = require('../utils/base64Url');
const { URL } = require('url');

// Domains that should be proxied (external ad networks, CDNs, etc.)
const EXTERNAL_DOMAINS_TO_PROXY = [
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'google.com',
  'gstatic.com',
  'googleapis.com',
  'googletagmanager.com',
  'google-analytics.com',
  'facebook.com',
  'facebook.net',
  'fbcdn.net',
  'twitter.com',
  'amazonaws.com',
  'cloudflare.com',
  'cloudfront.net',
  'akamaihd.net',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com'
];

/**
 * Check if a URL should be proxied
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function shouldProxyUrl(url) {
  if (!url) return false;
  
  // Skip data URLs, blob URLs, javascript:, etc.
  if (url.startsWith('data:') || 
      url.startsWith('blob:') || 
      url.startsWith('javascript:') ||
      url.startsWith('#') ||
      url.startsWith('about:')) {
    return false;
  }
  
  // Skip already proxied URLs
  if (url.includes('/p/') || url.includes('/api/proxy')) {
    return false;
  }
  
  // Check if it's an absolute URL
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
    try {
      const fullUrl = url.startsWith('//') ? 'https:' + url : url;
      const urlObj = new URL(fullUrl);
      const hostname = urlObj.hostname.toLowerCase();
      
      // Check if domain should be proxied
      return EXTERNAL_DOMAINS_TO_PROXY.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      );
    } catch (e) {
      return false;
    }
  }
  
  return false;
}

/**
 * Convert URL to proxy URL
 * @param {string} url - Original URL
 * @returns {string} - Proxy URL
 */
function toProxyUrl(url) {
  // Handle protocol-relative URLs
  if (url.startsWith('//')) {
    url = 'https:' + url;
  }
  return '/p/' + base64Url.encode(url);
}

/**
 * Process JavaScript content and rewrite external URLs
 * 
 * Strategy:
 * 1. Find string literals containing URLs (single quotes, double quotes)
 * 2. Find template literal URLs
 * 3. Replace with proxy URLs
 * 
 * @param {string} js - Original JavaScript content
 * @param {string} jsFileUrl - URL of the JS file (for context)
 * @returns {string} - Processed JavaScript
 */
function processJs(js, jsFileUrl) {
  if (!js) return js;
  
  let processed = js;
  let rewriteCount = 0;
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/0340e72d-1340-460d-ba20-9cf1a26cf9a8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jsProcessor.js:processJs',message:'JS Processing started',data:{jsFileUrl:jsFileUrl?.substring(0,60),jsLength:js?.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1-JS-REWRITE'})}).catch(()=>{});
  // #endregion
  
  // Pattern 1: Double-quoted URLs - 'https://...' or "https://..."
  // Match: "https://example.com/path" or 'https://example.com/path'
  const urlStringPattern = /(['"])(https?:\/\/[^'"]+)\1/g;
  
  processed = processed.replace(urlStringPattern, (match, quote, url) => {
    if (shouldProxyUrl(url)) {
      const proxyUrl = toProxyUrl(url);
      rewriteCount++;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/0340e72d-1340-460d-ba20-9cf1a26cf9a8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jsProcessor.js:urlRewrite',message:'URL rewritten in JS',data:{original:url.substring(0,60),proxied:proxyUrl.substring(0,40)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1-JS-REWRITE'})}).catch(()=>{});
      // #endregion
      return quote + proxyUrl + quote;
    }
    return match;
  });
  
  // Pattern 2: Protocol-relative URLs - '//example.com/path'
  const protocolRelativePattern = /(['"])(\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}[^'"]*)\1/g;
  
  processed = processed.replace(protocolRelativePattern, (match, quote, url) => {
    if (shouldProxyUrl(url)) {
      const proxyUrl = toProxyUrl(url);
      return quote + proxyUrl + quote;
    }
    return match;
  });
  
  // Pattern 3: Template literal URLs - `https://...`
  // This is trickier because template literals can have expressions
  // We'll only handle simple cases without expressions
  const templateUrlPattern = /`(https?:\/\/[^`$]+)`/g;
  
  processed = processed.replace(templateUrlPattern, (match, url) => {
    if (shouldProxyUrl(url)) {
      const proxyUrl = toProxyUrl(url);
      return '`' + proxyUrl + '`';
    }
    return match;
  });
  
  return processed;
}

/**
 * Check if JavaScript content contains any external URLs that need proxying
 * @param {string} js - JavaScript content
 * @returns {boolean}
 */
function hasExternalUrls(js) {
  if (!js) return false;
  
  const urlPattern = /(['"`])(https?:\/\/[^'"`]+)\1/g;
  let match;
  
  while ((match = urlPattern.exec(js)) !== null) {
    if (shouldProxyUrl(match[2])) {
      return true;
    }
  }
  
  return false;
}

module.exports = {
  processJs,
  shouldProxyUrl,
  toProxyUrl,
  hasExternalUrls,
  EXTERNAL_DOMAINS_TO_PROXY
};

