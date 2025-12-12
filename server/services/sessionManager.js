/**
 * Session Manager Service
 * 
 * Manages user sessions and maps them to sticky proxy IPs.
 * Handles server-side cookie jar for Google ADX cookies.
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// In-memory session store (Redis would be used in production)
const sessions = new Map();

// Session TTL in milliseconds
const SESSION_TTL = (parseInt(process.env.SESSION_TTL_MINUTES) || 120) * 60 * 1000;

/**
 * Session data structure
 */
class Session {
  constructor(id) {
    this.id = id;
    this.createdAt = Date.now();
    this.lastAccess = Date.now();
    this.currentPageUrl = null;
    this.cookies = {}; // Domain -> { cookieName: cookieData }
  }

  /**
   * Update last access time
   */
  touch() {
    this.lastAccess = Date.now();
  }

  /**
   * Check if session is expired
   */
  isExpired() {
    return Date.now() - this.lastAccess > SESSION_TTL;
  }

  /**
   * Set the current page URL (for Referer header)
   * @param {string} url - Target URL (not proxy URL)
   */
  setCurrentPage(url) {
    this.currentPageUrl = url;
    this.touch();
  }

  /**
   * Store cookies from Set-Cookie headers
   * @param {string} domain - Cookie domain
   * @param {Array} setCookieHeaders - Array of Set-Cookie header values
   */
  storeCookies(domain, setCookieHeaders) {
    if (!setCookieHeaders || setCookieHeaders.length === 0) return;

    if (!this.cookies[domain]) {
      this.cookies[domain] = {};
    }

    for (const cookieStr of setCookieHeaders) {
      const parsed = parseCookie(cookieStr);
      if (parsed) {
        // Normalize domain - remove leading dot if present for consistency
        let cookieDomain = parsed.domain || domain;
        
        // Handle domain attribute properly
        // If domain starts with '.', it means the cookie is valid for subdomains
        if (cookieDomain.startsWith('.')) {
          // Keep the leading dot for subdomain matching
          cookieDomain = cookieDomain;
        } else if (parsed.domain) {
          // If domain was explicitly set without leading dot, add it for subdomain matching
          cookieDomain = '.' + cookieDomain;
        }
        
        if (!this.cookies[cookieDomain]) {
          this.cookies[cookieDomain] = {};
        }
        
        // Store the cookie with all relevant attributes
        this.cookies[cookieDomain][parsed.name] = {
          value: parsed.value,
          expires: parsed.expires,
          path: parsed.path || '/',
          secure: parsed.secure,
          httpOnly: parsed.httpOnly,
          sameSite: parsed.sameSite,
          originalDomain: domain // Keep track of where it came from
        };
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/0340e72d-1340-460d-ba20-9cf1a26cf9a8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sessionManager.js:storeCookie',message:'Cookie stored',data:{name:parsed.name,domain:cookieDomain,path:parsed.path},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H8-COOKIE'})}).catch(()=>{});
        // #endregion
        
        // Also store under the exact domain for exact matches
        if (!this.cookies[domain]) {
          this.cookies[domain] = {};
        }
        this.cookies[domain][parsed.name] = this.cookies[cookieDomain][parsed.name];
      }
    }
  }

  /**
   * Get cookies for a specific domain
   * @param {string} targetDomain - Target domain
   * @param {string} path - Request path (optional, defaults to '/')
   * @returns {string} - Cookie header value
   */
  getCookiesForDomain(targetDomain, path = '/') {
    const matchingCookies = new Map(); // Use Map to avoid duplicates

    for (const [cookieDomain, cookies] of Object.entries(this.cookies)) {
      // Check domain matching (RFC 6265 compliant)
      let matches = false;
      
      // Exact match
      if (targetDomain === cookieDomain) {
        matches = true;
      }
      // Domain attribute with leading dot - matches subdomains
      else if (cookieDomain.startsWith('.')) {
        const domainWithoutDot = cookieDomain.substring(1);
        matches = targetDomain === domainWithoutDot || 
                  targetDomain.endsWith(cookieDomain);
      }
      // Domain without leading dot
      else {
        matches = targetDomain.endsWith('.' + cookieDomain);
      }

      if (!matches) continue;

      for (const [name, cookie] of Object.entries(cookies)) {
        // Check expiration
        if (cookie.expires) {
          const expiryDate = new Date(cookie.expires);
          if (expiryDate < new Date()) {
            continue; // Cookie expired
          }
        }
        
        // Check path matching
        const cookiePath = cookie.path || '/';
        if (!path.startsWith(cookiePath)) {
          continue;
        }

        // Add to matching cookies (Map prevents duplicates)
        matchingCookies.set(name, cookie.value);
      }
    }

    // Convert to cookie header string
    const cookiePairs = [];
    for (const [name, value] of matchingCookies) {
      cookiePairs.push(`${name}=${value}`);
    }

    return cookiePairs.join('; ');
  }
}

/**
 * Parse a Set-Cookie header string
 * @param {string} cookieStr - Set-Cookie header value
 * @returns {Object|null}
 */
function parseCookie(cookieStr) {
  if (!cookieStr) return null;

  const parts = cookieStr.split(';').map(p => p.trim());
  const [nameValue, ...attributes] = parts;
  
  const [name, ...valueParts] = nameValue.split('=');
  const value = valueParts.join('=');

  // Name is required, but value can be empty (for cookie deletion)
  if (!name) return null;

  const cookie = {
    name: name.trim(),
    value: (value || '').trim(),
    domain: null,
    path: '/',
    expires: null,
    secure: false,
    httpOnly: false,
    sameSite: null
  };

  for (const attr of attributes) {
    const [attrName, ...attrValueParts] = attr.split('=');
    const attrValue = attrValueParts.join('=');
    const attrNameLower = attrName.toLowerCase().trim();

    switch (attrNameLower) {
      case 'domain':
        cookie.domain = attrValue.trim();
        break;
      case 'path':
        cookie.path = attrValue.trim();
        break;
      case 'expires':
        cookie.expires = attrValue.trim();
        break;
      case 'max-age':
        const maxAge = parseInt(attrValue);
        if (!isNaN(maxAge)) {
          if (maxAge <= 0) {
            // Cookie should be deleted
            cookie.expires = new Date(0).toUTCString();
          } else {
            cookie.expires = new Date(Date.now() + maxAge * 1000).toUTCString();
          }
        }
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'samesite':
        cookie.sameSite = attrValue ? attrValue.trim().toLowerCase() : 'lax';
        break;
    }
  }

  return cookie;
}

/**
 * Get or create a session
 * @param {string} sessionId - Existing session ID (from cookie) or null
 * @returns {Session}
 */
function getOrCreateSession(sessionId) {
  // Try to get existing session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    
    if (!session.isExpired()) {
      session.touch();
      return session;
    }
    
    // Session expired, delete it
    sessions.delete(sessionId);
    logger.debug('Session expired', { sessionId: sessionId.substring(0, 8) });
  }

  // Create new session
  const newId = uuidv4();
  const newSession = new Session(newId);
  sessions.set(newId, newSession);
  
  logger.info('New session created', { sessionId: newId.substring(0, 8) });
  
  return newSession;
}

/**
 * Get a session by ID (does not create if not exists)
 * @param {string} sessionId
 * @returns {Session|null}
 */
function getSession(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) {
    return null;
  }
  
  const session = sessions.get(sessionId);
  
  if (session.isExpired()) {
    sessions.delete(sessionId);
    return null;
  }
  
  session.touch();
  return session;
}

/**
 * Delete a session
 * @param {string} sessionId
 */
function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Clean up expired sessions (run periodically)
 */
function cleanupExpiredSessions() {
  let cleaned = 0;
  
  for (const [id, session] of sessions.entries()) {
    if (session.isExpired()) {
      sessions.delete(id);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug('Cleaned up expired sessions', { count: cleaned });
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

module.exports = {
  getOrCreateSession,
  getSession,
  deleteSession,
  cleanupExpiredSessions,
  Session
};


