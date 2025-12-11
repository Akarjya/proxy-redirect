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
        const cookieDomain = parsed.domain || domain;
        if (!this.cookies[cookieDomain]) {
          this.cookies[cookieDomain] = {};
        }
        this.cookies[cookieDomain][parsed.name] = {
          value: parsed.value,
          expires: parsed.expires,
          path: parsed.path || '/',
          secure: parsed.secure,
          httpOnly: parsed.httpOnly
        };
      }
    }
  }

  /**
   * Get cookies for a specific domain
   * @param {string} targetDomain - Target domain
   * @returns {string} - Cookie header value
   */
  getCookiesForDomain(targetDomain) {
    const matchingCookies = [];

    for (const [cookieDomain, cookies] of Object.entries(this.cookies)) {
      // Check domain matching
      const matches = 
        targetDomain === cookieDomain ||
        (cookieDomain.startsWith('.') && targetDomain.endsWith(cookieDomain)) ||
        targetDomain.endsWith('.' + cookieDomain);

      if (!matches) continue;

      for (const [name, cookie] of Object.entries(cookies)) {
        // Check expiration
        if (cookie.expires && new Date(cookie.expires) < new Date()) {
          continue;
        }

        matchingCookies.push(`${name}=${cookie.value}`);
      }
    }

    return matchingCookies.join('; ');
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

  if (!name || !value) return null;

  const cookie = {
    name: name.trim(),
    value: value.trim(),
    domain: null,
    path: '/',
    expires: null,
    secure: false,
    httpOnly: false
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
          cookie.expires = new Date(Date.now() + maxAge * 1000).toUTCString();
        }
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
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

