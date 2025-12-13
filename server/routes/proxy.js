/**
 * Proxy Route Handler
 * 
 * Main proxy endpoint that fetches content through 922proxy.
 * Handles HTML/CSS processing, header management, and response streaming.
 */

const express = require('express');
const router = express.Router();
const base64Url = require('../utils/base64Url');
const urlValidator = require('../utils/urlValidator');
const sessionManager = require('../services/sessionManager');
const contentFetcher = require('../services/contentFetcher');
const htmlProcessor = require('../services/htmlProcessor');
const cssProcessor = require('../services/cssProcessor');
const jsProcessor = require('../services/jsProcessor');
const urlShortener = require('../services/urlShortener');
const logger = require('../utils/logger');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'proxy_session';

// Google ad domains that need HTML rewriting with script injection
// These domains serve ad iframes that need our interception scripts
const GOOGLE_AD_HOSTNAMES = [
  'googleads.g.doubleclick.net',
  'pagead2.googlesyndication.com',
  'securepubads.g.doubleclick.net',
  'tpc.googlesyndication.com',
  'googleadservices.com',
  'www.googleadservices.com',
  'partner.googleadservices.com',
  'adtrafficquality.google',
  'ep1.adtrafficquality.google',
  'ep2.adtrafficquality.google',
  'googlesyndication.com',
  'doubleclick.net'
];

// URLs (with path) that need script injection
const GOOGLE_AD_URL_PATTERNS = [
  '/recaptcha/api2/aframe',
  '/recaptcha/enterprise/aframe',
  '/pagead/'
];

/**
 * Check if URL is from Google ad domain or matches ad URL patterns
 */
function isGoogleAdDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;
    
    // Check hostname matches
    const isAdHostname = GOOGLE_AD_HOSTNAMES.some(d => 
      hostname === d || hostname.endsWith('.' + d)
    );
    
    if (isAdHostname) return true;
    
    // Check URL path patterns
    const isAdUrlPattern = GOOGLE_AD_URL_PATTERNS.some(pattern => 
      pathname.includes(pattern)
    );
    
    return isAdUrlPattern;
  } catch {
    return false;
  }
}

/**
 * Determine content type category
 */
function getContentTypeCategory(contentType) {
  if (!contentType) return 'binary';
  
  const lower = contentType.toLowerCase();
  
  if (lower.includes('text/html')) return 'html';
  if (lower.includes('text/css')) return 'css';
  if (lower.includes('javascript') || lower.includes('ecmascript')) return 'js';
  if (lower.includes('text/')) return 'text';
  if (lower.includes('application/json')) return 'json';
  if (lower.includes('application/xml') || lower.includes('text/xml')) return 'xml';
  
  return 'binary';
}

/**
 * GET /api/proxy - Main proxy endpoint (called by Service Worker)
 */
router.get('/proxy', async (req, res) => {
  logger.info('=== PROXY ROUTE HIT ===', { url: req.query.url?.substring(0, 30) });
  
  const encodedUrl = req.query.url;
  
  if (!encodedUrl) {
    logger.error('Missing URL parameter');
    return res.status(400).json({ error: 'Missing URL parameter' });
  }
  
  // Decode URL
  let targetUrl;
  try {
    targetUrl = base64Url.decode(encodedUrl);
  } catch (error) {
    logger.error('URL decode error', { error: error.message });
    return res.status(400).json({ error: 'Invalid encoded URL' });
  }
  
  // Validate URL
  const validation = urlValidator.validateUrlSync(targetUrl);
  if (!validation.valid) {
    logger.warn('URL validation failed', { url: targetUrl.substring(0, 50), error: validation.error });
    return res.status(400).json({ error: validation.error });
  }
  
  // Get session
  logger.debug('Getting session', { sessionId: req.cookies[SESSION_COOKIE_NAME]?.substring(0, 8) });
  const sessionId = req.cookies[SESSION_COOKIE_NAME];
  const session = sessionManager.getOrCreateSession(sessionId);
  logger.debug('Session obtained', { sessionId: session.id.substring(0, 8) });
  
  // Set session cookie if new
  if (!sessionId || sessionId !== session.id) {
    res.cookie(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 120 * 60 * 1000,
      sameSite: 'lax'
    });
  }
  
  try {
    // ═══════════════════════════════════════════════════════════
    // LOG AD REQUESTS FOR DEBUGGING
    // ═══════════════════════════════════════════════════════════
    const isAdRequest = isGoogleAdDomain(targetUrl);
    if (isAdRequest) {
      logger.info('🎯 GOOGLE AD REQUEST DETECTED', { 
        url: targetUrl.substring(0, 100),
        sessionId: session.id.substring(0, 8),
        ip: 'will-be-proxied-through-922proxy'
      });
    }
    
    logger.info('Starting proxy fetch', { url: targetUrl.substring(0, 60), isAd: isAdRequest });
    
    // Build options from request headers
    const options = {
      method: 'GET',
      headers: {
        'x-original-ua': req.headers['x-original-ua'],
        'user-agent': req.headers['user-agent'],
        'accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate'
      }
    };
    
    // Fetch through proxy
    logger.debug('Fetching through proxy...');
    const result = await contentFetcher.fetchText(targetUrl, options, session);
    logger.info('Fetch completed', { status: result.response?.status });
    
    // Handle redirects
    if (result.isRedirect && result.redirectUrl) {
      const redirectProxyUrl = base64Url.toProxyPath(result.redirectUrl);
      return res.redirect(result.response.status, redirectProxyUrl);
    }
    
    // Get content type
    const contentType = result.response.headers.get('content-type') || '';
    const category = getContentTypeCategory(contentType);
    
    // Update session with current page (for HTML pages)
    if (category === 'html') {
      session.setCurrentPage(targetUrl);
    }
    
    // Set response headers
    res.status(result.response.status);
    
    // Forward safe headers (excluding security headers that would block our scripts)
    const headersToForward = [
      'content-type',
      'cache-control',
      'expires',
      'last-modified',
      'etag'
    ];
    
    // Headers to explicitly NOT forward (these can block our injected scripts)
    // - Content-Security-Policy: blocks inline scripts
    // - X-Frame-Options: blocks iframe embedding
    // - X-Content-Type-Options: can cause issues with modified content
    const headersToBlock = [
      'content-security-policy',
      'content-security-policy-report-only',
      'x-frame-options',
      'x-xss-protection'
    ];
    
    for (const header of headersToForward) {
      const value = result.response.headers.get(header);
      if (value) {
        res.set(header, value);
      }
    }
    
    // Log if we're blocking CSP (for debugging)
    const csp = result.response.headers.get('content-security-policy');
    if (csp) {
      logger.debug('Blocked CSP header from response', { 
        url: targetUrl.substring(0, 50),
        csp: csp.substring(0, 100) + '...'
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/0340e72d-1340-460d-ba20-9cf1a26cf9a8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'proxy.js:cspBlock',message:'CSP header blocked',data:{url:targetUrl.substring(0,60),csp:csp.substring(0,80)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3-CSP-BLOCK'})}).catch(()=>{});
      // #endregion
    }
    
    // Process content based on type
    let responseBody = result.text;
    
    if (category === 'html') {
      // Check if Google ad content
      if (isGoogleAdDomain(targetUrl)) {
        responseBody = htmlProcessor.processGoogleAdHtml(responseBody, targetUrl);
      } else {
        responseBody = htmlProcessor.processHtml(responseBody, targetUrl);
      }
      res.set('Content-Type', 'text/html; charset=utf-8');
      // EXPLICITLY set permissive CSP to OVERRIDE any existing CSP
      // This ensures Google Ads scripts can load dynamically
      res.set('Content-Security-Policy', 
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
        "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
        "frame-src * data: blob:; " +
        "frame-ancestors *;"
      );
      
    } else if (category === 'css') {
      responseBody = cssProcessor.processCss(responseBody, targetUrl);
      res.set('Content-Type', 'text/css; charset=utf-8');
      
    } else if (category === 'js') {
      // Process JavaScript to rewrite external URLs
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/0340e72d-1340-460d-ba20-9cf1a26cf9a8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'proxy.js:jsProcess',message:'Processing JS file',data:{url:targetUrl.substring(0,60),size:responseBody?.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1-JS-REWRITE'})}).catch(()=>{});
      // #endregion
      responseBody = jsProcessor.processJs(responseBody, targetUrl);
      res.set('Content-Type', 'application/javascript; charset=utf-8');
    }
    
    // Send response
    res.send(responseBody);
    
  } catch (error) {
    logger.error('Proxy error', { 
      url: targetUrl.substring(0, 50), 
      error: error.message 
    });
    
    res.status(502).json({
      error: 'Proxy fetch failed',
      message: error.message
    });
  }
});

/**
 * POST /api/proxy - Handle POST requests through proxy
 */
router.post('/proxy', async (req, res) => {
  const encodedUrl = req.query.url;
  
  if (!encodedUrl) {
    return res.status(400).json({ error: 'Missing URL parameter' });
  }
  
  let targetUrl;
  try {
    targetUrl = base64Url.decode(encodedUrl);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid encoded URL' });
  }
  
  const validation = urlValidator.validateUrlSync(targetUrl);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  
  const sessionId = req.cookies[SESSION_COOKIE_NAME];
  const session = sessionManager.getOrCreateSession(sessionId);
  
  try {
    const options = {
      method: 'POST',
      headers: {
        'x-original-ua': req.headers['x-original-ua'],
        'user-agent': req.headers['user-agent'],
        'accept': req.headers['accept'],
        'accept-language': req.headers['accept-language'],
        'content-type': req.headers['content-type']
      },
      body: req.body
    };
    
    const result = await contentFetcher.fetchText(targetUrl, options, session);
    
    if (result.isRedirect && result.redirectUrl) {
      const redirectProxyUrl = base64Url.toProxyPath(result.redirectUrl);
      return res.redirect(result.response.status, redirectProxyUrl);
    }
    
    const contentType = result.response.headers.get('content-type') || '';
    res.set('Content-Type', contentType);
    res.status(result.response.status);
    res.send(result.text);
    
  } catch (error) {
    logger.error('POST Proxy error', { url: targetUrl.substring(0, 50), error: error.message });
    res.status(502).json({ error: 'Proxy fetch failed', message: error.message });
  }
});

/**
 * GET /p/s/:hash - Short URL proxy path (for long URLs that exceed path limits)
 * This handles URLs that were shortened via /api/shorten
 */
router.get('/p/s/:hash', async (req, res) => {
  const hash = req.params.hash;
  
  if (!hash) {
    return res.status(400).json({ error: 'Missing URL hash' });
  }
  
  // Lookup full URL from hash
  const fullUrl = urlShortener.getUrl(hash);
  
  if (!fullUrl) {
    logger.warn('Short URL not found or expired', { hash });
    return res.status(404).json({ 
      error: 'URL not found or expired',
      message: 'The short URL may have expired. Please go back and try again.'
    });
  }
  
  logger.info('Short URL resolved', { hash, urlPreview: fullUrl.substring(0, 60) });
  
  // Encode the full URL and redirect to proxy
  const encodedUrl = base64Url.encode(fullUrl);
  res.redirect(`/api/proxy?url=${encodeURIComponent(encodedUrl)}`);
});

/**
 * GET /p/:encoded - Direct proxy path (fallback for non-SW requests)
 */
router.get('/p/:encoded(*)', async (req, res) => {
  const encodedUrl = req.params.encoded;
  
  if (!encodedUrl) {
    return res.status(400).send('Missing encoded URL');
  }
  
  // Check if it's a short URL format (starts with 's/')
  if (encodedUrl.startsWith('s/')) {
    const hash = encodedUrl.substring(2);
    const fullUrl = urlShortener.getUrl(hash);
    
    if (fullUrl) {
      const encoded = base64Url.encode(fullUrl);
      return res.redirect(`/api/proxy?url=${encodeURIComponent(encoded)}`);
    }
  }
  
  // Redirect to API proxy endpoint
  res.redirect(`/api/proxy?url=${encodeURIComponent(encodedUrl)}`);
});

module.exports = router;

