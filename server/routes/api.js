/**
 * API Routes
 * 
 * Handles session management and utility endpoints.
 */

const express = require('express');
const router = express.Router();
const sessionManager = require('../services/sessionManager');
const proxyPool = require('../services/proxyPool');
const urlShortener = require('../services/urlShortener');
const logger = require('../utils/logger');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'proxy_session';
const SESSION_TTL_MINUTES = parseInt(process.env.SESSION_TTL_MINUTES) || 120;

/**
 * POST /api/session - Create or get existing session
 */
router.post('/session', (req, res) => {
  try {
    // Get existing session ID from cookie
    const existingSessionId = req.cookies[SESSION_COOKIE_NAME];
    
    // Get or create session
    const session = sessionManager.getOrCreateSession(existingSessionId);
    
    // Set session cookie
    res.cookie(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MINUTES * 60 * 1000,
      sameSite: 'lax'
    });
    
    logger.info('Session API called', { 
      sessionId: session.id.substring(0, 8),
      isNew: existingSessionId !== session.id
    });
    
    res.json({
      success: true,
      sessionId: session.id,
      expiresIn: SESSION_TTL_MINUTES * 60
    });
    
  } catch (error) {
    logger.error('Session creation error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create session'
    });
  }
});

/**
 * GET /api/session - Get current session info
 */
router.get('/session', (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE_NAME];
  const session = sessionId ? sessionManager.getSession(sessionId) : null;
  
  if (session) {
    res.json({
      success: true,
      hasSession: true,
      sessionId: session.id.substring(0, 8) + '...',
      currentPage: session.currentPageUrl
    });
  } else {
    res.json({
      success: true,
      hasSession: false
    });
  }
});

/**
 * DELETE /api/session - Delete current session
 */
router.delete('/session', (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE_NAME];
  
  if (sessionId) {
    sessionManager.deleteSession(sessionId);
    res.clearCookie(SESSION_COOKIE_NAME);
  }
  
  res.json({
    success: true,
    message: 'Session deleted'
  });
});

/**
 * GET /api/status - Server status
 */
router.get('/status', (req, res) => {
  const proxyInfo = proxyPool.getProxyInfo();
  
  res.json({
    success: true,
    server: 'running',
    proxy: {
      configured: proxyInfo.configured,
      host: proxyInfo.host,
      region: proxyInfo.region
    },
    targetSite: process.env.TARGET_SITE
  });
});

/**
 * GET /api/health - Health check
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/shorten - Store a long URL and return short hash
 * Used for URLs that exceed browser path length limits (Google Ads tracking URLs)
 */
router.post('/shorten', express.json(), (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Store URL and get hash
    const hash = urlShortener.storeUrl(url);
    
    logger.info('URL shortened', { 
      hash, 
      originalLength: url.length 
    });
    
    res.json({
      success: true,
      hash: hash,
      shortUrl: `/p/s/${hash}`
    });
    
  } catch (error) {
    logger.error('URL shortening error', { error: error.message });
    res.status(500).json({ error: 'Failed to shorten URL' });
  }
});

/**
 * GET /api/url-stats - Get URL shortener stats (for debugging)
 */
router.get('/url-stats', (req, res) => {
  res.json(urlShortener.getStats());
});

module.exports = router;

