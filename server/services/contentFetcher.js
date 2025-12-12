/**
 * Content Fetcher Service
 * 
 * Fetches content from target URLs through the 922proxy.
 * Handles headers, cookies, redirects, and response processing.
 */

const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { URL } = require('url');
const proxyPool = require('./proxyPool');
const logger = require('../utils/logger');

// Default User-Agent if none provided
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Build headers for the proxy request
 * Handles Referer, User-Agent, Accept headers properly
 * 
 * @param {Object} originalHeaders - Headers from the original request
 * @param {Object} session - User session object
 * @param {string} targetUrl - Target URL being fetched
 * @returns {Object} - Headers to send to target
 */
function buildProxyHeaders(originalHeaders, session, targetUrl) {
  const targetDomain = new URL(targetUrl).hostname;
  
  // Get cookies from session for this domain
  const cookies = session ? session.getCookiesForDomain(targetDomain) : '';
  
  const headers = {
    // FORWARDED FROM USER'S BROWSER
    'User-Agent': originalHeaders['x-original-ua'] || 
                  originalHeaders['user-agent'] || 
                  DEFAULT_USER_AGENT,
    
    'Accept': originalHeaders['accept'] || '*/*',
    
    'Accept-Language': originalHeaders['accept-language'] || 'en-US,en;q=0.9',
    
    'Accept-Encoding': 'gzip, deflate, br',
    
    // SET BY OUR BACKEND (correct Referer)
    // This is the target page URL, not our proxy URL
    ...(session?.currentPageUrl && { 'Referer': session.currentPageUrl }),
    
    // FROM SERVER-SIDE COOKIE JAR
    ...(cookies && { 'Cookie': cookies }),
  };

  // Forward Content-Type for POST/PUT requests
  if (originalHeaders['content-type']) {
    headers['Content-Type'] = originalHeaders['content-type'];
  }

  // DO NOT include these (they would reveal the proxy):
  // - Host (auto-set by fetch)
  // - Origin (would show proxy domain)
  // - X-Forwarded-For (reveals user IP)
  // - Browser's Referer (shows proxy URL)

  return headers;
}

/**
 * Fetch content through the proxy
 * 
 * @param {string} targetUrl - URL to fetch
 * @param {Object} options - Fetch options
 * @param {Object} options.headers - Original request headers
 * @param {string} options.method - HTTP method (default: GET)
 * @param {string|Buffer} options.body - Request body for POST/PUT
 * @param {Object} session - User session
 * @returns {Promise<Object>} - Response object with body, headers, status
 */
// Check if proxy should be used (can be disabled for testing)
// TEMPORARY: Disabled proxy for testing due to 922proxy TLS issues
const USE_PROXY = process.env.USE_PROXY === 'true'; // Changed: now defaults to false

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EAI_AGAIN',
    'socket hang up',
    'Client network socket disconnected'
  ],
  retryableStatusCodes: [502, 503, 504, 408, 429]
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable
 */
function isRetryableError(error) {
  if (!error) return false;
  
  // Check error code
  if (error.code && RETRY_CONFIG.retryableErrors.includes(error.code)) {
    return true;
  }
  
  // Check error message
  if (error.message) {
    return RETRY_CONFIG.retryableErrors.some(e => 
      error.message.toLowerCase().includes(e.toLowerCase())
    );
  }
  
  return false;
}

/**
 * Check if status code is retryable
 */
function isRetryableStatus(status) {
  return RETRY_CONFIG.retryableStatusCodes.includes(status);
}

async function fetchThroughProxy(targetUrl, options = {}, session) {
  const sessionId = session?.id || 'default';
  
  // Build headers
  const headers = buildProxyHeaders(options.headers || {}, session, targetUrl);
  
  logger.proxyRequest(options.method || 'GET', targetUrl, sessionId);
  
  let lastError = null;
  let attempt = 0;
  
  while (attempt <= RETRY_CONFIG.maxRetries) {
    try {
      const parsedUrl = new URL(targetUrl);
      
      // Configure axios options
      const axiosConfig = {
        url: targetUrl,
        method: options.method || 'GET',
        headers: headers,
        data: options.body,
        timeout: 30000,
        maxRedirects: 0, // Handle redirects ourselves
        validateStatus: () => true, // Accept all status codes
        responseType: 'arraybuffer', // Get raw data
        decompress: true // Auto-decompress gzip/deflate
      };
      
      // Add proxy agent if enabled
      if (USE_PROXY) {
        const proxyUrl = proxyPool.buildProxyUrl(sessionId);
        const httpsAgent = new SocksProxyAgent(proxyUrl);
        const httpAgent = new SocksProxyAgent(proxyUrl);
        axiosConfig.httpAgent = httpAgent;
        axiosConfig.httpsAgent = httpsAgent;
        if (attempt === 0) {
          logger.debug('Using proxy', { proxyHost: process.env.PROXY_HOST });
        }
      } else {
        if (attempt === 0) {
          logger.debug('Proxy disabled, direct connection');
        }
      }
      
      const response = await axios(axiosConfig);
      
      // Check if response status is retryable
      if (isRetryableStatus(response.status) && attempt < RETRY_CONFIG.maxRetries) {
        logger.warn('Retryable status code received', {
          url: targetUrl.substring(0, 50),
          status: response.status,
          attempt: attempt + 1
        });
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/0340e72d-1340-460d-ba20-9cf1a26cf9a8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'contentFetcher.js:retry',message:'Retrying request',data:{url:targetUrl.substring(0,60),status:response.status,attempt:attempt+1},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H9-RETRY'})}).catch(()=>{});
        // #endregion
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
          RETRY_CONFIG.maxDelayMs
        );
        
        await sleep(delay);
        attempt++;
        continue;
      }
      
      logger.proxyResponse(targetUrl, response.status, response.headers['content-type']);
      
      // Capture Set-Cookie headers and store in session
      if (session && response.headers['set-cookie']) {
        const setCookies = Array.isArray(response.headers['set-cookie']) 
          ? response.headers['set-cookie'] 
          : [response.headers['set-cookie']];
        const domain = parsedUrl.hostname;
        session.storeCookies(domain, setCookies);
      }
      
      // Create a headers object with helper methods
      const headersObj = {
        _headers: response.headers,
        get: function(name) {
          return this._headers[name.toLowerCase()];
        },
        raw: function() {
          return this._headers;
        }
      };
      
      return {
        status: response.status,
        statusText: response.statusText,
        headers: headersObj,
        body: Buffer.from(response.data),
        url: targetUrl,
        isRedirect: [301, 302, 303, 307, 308].includes(response.status),
        redirectUrl: response.headers.location
      };
      
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (isRetryableError(error) && attempt < RETRY_CONFIG.maxRetries) {
        logger.warn('Retryable error, will retry', {
          url: targetUrl.substring(0, 50),
          error: error.message,
          attempt: attempt + 1,
          maxRetries: RETRY_CONFIG.maxRetries
        });
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
          RETRY_CONFIG.maxDelayMs
        );
        
        await sleep(delay);
        attempt++;
        continue;
      }
      
      // Non-retryable error or max retries reached
      logger.error('Proxy fetch error', { 
        url: targetUrl.substring(0, 50), 
        error: error.message,
        attempts: attempt + 1
      });
      throw error;
    }
  }
  
  // This should not be reached, but just in case
  throw lastError || new Error('Max retries reached');
}

/**
 * Fetch and return text content
 * @param {string} targetUrl
 * @param {Object} options
 * @param {Object} session
 * @returns {Promise<{text: string, response: Object}>}
 */
async function fetchText(targetUrl, options = {}, session) {
  const response = await fetchThroughProxy(targetUrl, options, session);
  
  // Handle redirects
  if (response.isRedirect && response.redirectUrl) {
    // Return redirect info, let caller handle it
    return {
      text: null,
      response: response,
      isRedirect: true,
      redirectUrl: response.redirectUrl
    };
  }
  
  // Body is already a buffer in our new implementation
  const text = response.body.toString('utf-8');
  
  return {
    text: text,
    response: response,
    isRedirect: false
  };
}

/**
 * Fetch and return buffer (for binary content like images)
 * @param {string} targetUrl
 * @param {Object} options
 * @param {Object} session
 * @returns {Promise<{buffer: Buffer, response: Object}>}
 */
async function fetchBuffer(targetUrl, options = {}, session) {
  const response = await fetchThroughProxy(targetUrl, options, session);
  
  // Handle redirects
  if (response.isRedirect && response.redirectUrl) {
    return {
      buffer: null,
      response: response,
      isRedirect: true,
      redirectUrl: response.redirectUrl
    };
  }
  
  // Body is already a buffer
  return {
    buffer: response.body,
    response: response,
    isRedirect: false
  };
}

/**
 * Stream response directly (for large files)
 * @param {string} targetUrl
 * @param {Object} options
 * @param {Object} session
 * @returns {Promise<Object>} - Response with body stream
 */
async function fetchStream(targetUrl, options = {}, session) {
  return fetchThroughProxy(targetUrl, options, session);
}

module.exports = {
  fetchThroughProxy,
  fetchText,
  fetchBuffer,
  fetchStream,
  buildProxyHeaders
};

