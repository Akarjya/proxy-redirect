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

/**
 * POST /api/click-beacon - Register ad click through proxy and get final destination
 * 
 * This endpoint:
 * 1. Receives the Google Ads click URL + browser context
 * 2. Makes the request through 922proxy (hides user IP from Google)
 * 3. Follows redirects to get the final advertiser URL
 * 4. Returns the final destination for navigation
 * 
 * All user data (cookies, user-agent, referrer) is forwarded to Google,
 * but IP is hidden via proxy.
 */
router.post('/click-beacon', express.json(), async (req, res) => {
  const contentFetcher = require('../services/contentFetcher');
  const base64Url = require('../utils/base64Url');
  
  try {
    const { 
      clickUrl,        // Google Ads click URL
      cookies,         // Browser cookies (document.cookie)
      userAgent,       // Browser user-agent
      referrer,        // Page referrer
      language,        // Accept-Language
      adurl            // Pre-extracted adurl (fallback destination)
    } = req.body;
    
    if (!clickUrl) {
      return res.status(400).json({ error: 'clickUrl is required' });
    }
    
    logger.info('Click beacon received', { 
      clickUrl: clickUrl.substring(0, 80),
      hasAdurl: !!adurl
    });
    
    // Get or create session for cookie management
    const sessionId = req.cookies?.proxy_session;
    const session = sessionId ? sessionManager.getSession(sessionId) : null;
    
    // If we have a session, store any Google cookies from the browser
    if (session && cookies) {
      // Parse and store cookies for Google domains
      const googleDomains = [
        'google.com', '.google.com',
        'doubleclick.net', '.doubleclick.net',
        'googleadservices.com', '.googleadservices.com',
        'googlesyndication.com', '.googlesyndication.com'
      ];
      
      // Store cookies for each Google domain
      const cookiePairs = cookies.split(';').map(c => c.trim()).filter(c => c);
      for (const domain of googleDomains) {
        const setCookieHeaders = cookiePairs.map(pair => `${pair}; Domain=${domain}; Path=/`);
        session.storeCookies(domain, setCookieHeaders);
      }
    }
    
    // Build headers with all browser context
    const requestHeaders = {
      'User-Agent': userAgent || req.headers['user-agent'],
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': language || req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': referrer || '',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    };
    
    // Add cookies if we have them
    if (cookies) {
      requestHeaders['Cookie'] = cookies;
    }
    
    let finalDestination = adurl; // Fallback to pre-extracted adurl
    let clickRegistered = false;
    
    try {
      // Make the click request through proxy - follow redirects to find final destination
      let currentUrl = clickUrl;
      let redirectCount = 0;
      const maxRedirects = 10;
      
      while (redirectCount < maxRedirects) {
        logger.debug('Click beacon: fetching', { 
          url: currentUrl.substring(0, 60),
          redirect: redirectCount
        });
        
        const response = await contentFetcher.fetchThroughProxy(
          currentUrl,
          { 
            method: 'GET',
            headers: requestHeaders
          },
          session
        );
        
        // If it's a redirect, follow it
        if (response.isRedirect && response.redirectUrl) {
          // Resolve relative URLs
          const nextUrl = new URL(response.redirectUrl, currentUrl).href;
          
          logger.debug('Click beacon: redirect', {
            from: currentUrl.substring(0, 40),
            to: nextUrl.substring(0, 60)
          });
          
          // Check if we've reached the advertiser's domain (not Google)
          const nextDomain = new URL(nextUrl).hostname;
          const isGoogleDomain = nextDomain.includes('google') || 
                                  nextDomain.includes('doubleclick');
          
          if (!isGoogleDomain) {
            // We've reached the advertiser's landing page!
            finalDestination = nextUrl;
            clickRegistered = true;
            logger.info('Click beacon: reached advertiser', { 
              destination: nextUrl.substring(0, 60)
            });
            break;
          }
          
          currentUrl = nextUrl;
          redirectCount++;
          
          // Update referer for next request
          requestHeaders['Referer'] = currentUrl;
        } else {
          // Not a redirect - we might be at the final destination
          // Or Google returned an error (like 404)
          
          if (response.status >= 200 && response.status < 400) {
            // Success - this might be the final page
            finalDestination = currentUrl;
            clickRegistered = true;
          } else {
            // Error from Google - use fallback adurl
            logger.warn('Click beacon: Google returned error', {
              status: response.status,
              url: currentUrl.substring(0, 60)
            });
          }
          break;
        }
      }
      
      if (redirectCount >= maxRedirects) {
        logger.warn('Click beacon: max redirects reached');
      }
      
    } catch (fetchError) {
      logger.error('Click beacon: fetch error', { 
        error: fetchError.message,
        clickUrl: clickUrl.substring(0, 60)
      });
      // Continue with fallback adurl
    }
    
    // If we still don't have a destination, try to extract from original URL
    if (!finalDestination) {
      try {
        const urlObj = new URL(clickUrl);
        const adurlParam = urlObj.searchParams.get('adurl');
        if (adurlParam) {
          finalDestination = decodeURIComponent(adurlParam);
          logger.info('Click beacon: using extracted adurl', {
            destination: finalDestination.substring(0, 60)
          });
        }
      } catch (e) {
        logger.error('Click beacon: failed to extract adurl', { error: e.message });
      }
    }
    
    if (!finalDestination) {
      return res.status(400).json({ 
        error: 'Could not determine destination URL',
        clickRegistered: false
      });
    }
    
    // Return the final destination as a proxy URL
    const proxyPath = base64Url.toProxyPath(finalDestination);
    
    logger.info('Click beacon: success', {
      clickRegistered,
      destination: finalDestination.substring(0, 60),
      proxyPath: proxyPath.substring(0, 40)
    });
    
    res.json({
      success: true,
      clickRegistered,
      destination: finalDestination,
      proxyUrl: proxyPath
    });
    
  } catch (error) {
    logger.error('Click beacon error', { error: error.message });
    res.status(500).json({ 
      error: 'Click beacon failed',
      message: error.message
    });
  }
});

module.exports = router;

