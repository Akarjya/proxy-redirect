/**
 * Service Worker - Proxy Interception
 * 
 * Intercepts all network requests and routes /p/* requests through the backend proxy.
 * Handles session management and request forwarding.
 * 
 * Version: 5 - ENHANCED FIX: Aggressive iframe interception
 * - Added explicit iframe destination detection
 * - Fixed Google Ad iframes bypassing proxy
 * - Special handling for destination === 'iframe'
 * - Ensures ALL ad requests go through proxy server
 */

// Cache name - increment to force SW update
const CACHE_NAME = 'proxy-poc-v5';

/**
 * Install event - Called when SW is first installed
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  
  // Skip waiting to activate immediately
  self.skipWaiting();
});

/**
 * Activate event - Called when SW becomes active
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activated');
  
  // Claim all clients immediately (don't wait for refresh)
  event.waitUntil(clients.claim());
});

/**
 * Base64 URL encode (for converting URLs to proxy format)
 */
function base64UrlEncode(str) {
  // Use TextEncoder for proper UTF-8 handling
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  
  // Convert to base64
  let base64 = '';
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.length; i++) {
    base64 += String.fromCharCode(bytes[i]);
  }
  base64 = btoa(base64);
  
  // Make URL-safe
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64 URL decode
 */
function base64UrlDecode(encoded) {
  // Restore base64 format
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  
  // Add padding if needed
  const padding = base64.length % 4;
  if (padding) {
    base64 += '='.repeat(4 - padding);
  }
  
  // Decode
  const decoded = atob(base64);
  
  // Convert to UTF-8
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/**
 * Normalize external URLs so protocol-relative values (//example.com) are handled
 * @param {string} url
 * @returns {string}
 */
function normalizeExternalUrl(url) {
  if (!url) return url;
  if (typeof url === 'string' && url.startsWith('//')) {
    return (self.location?.protocol || 'https:') + url;
  }
  return url;
}

/**
 * Check if request should be proxied
 * V2: Handles both /p/ and /external/ formats
 */
function isProxyRequest(url) {
  const urlObj = new URL(url);
  return urlObj.pathname.startsWith('/p/') || urlObj.pathname.startsWith('/external/');
}

/**
 * Check if request is for a static file that should pass through
 */
function isStaticAsset(url) {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  
  // Files that should NOT be proxied (served directly)
  return (
    path === '/' ||
    path === '/index.html' ||
    path === '/sw.js' ||
    path.startsWith('/assets/') ||
    path.startsWith('/api/')
  );
}

/**
 * Check if URL is an external URL that should be proxied
 */
function isExternalUrl(url) {
  try {
    const normalized = normalizeExternalUrl(url);
    const urlObj = new URL(normalized);
    // External if different origin from our service worker
    return urlObj.origin !== self.location.origin;
  } catch (e) {
    return false;
  }
}

/**
 * Convert external URL to proxy URL
 */
function externalToProxyUrl(url) {
  const normalized = normalizeExternalUrl(url);
  const encoded = base64UrlEncode(normalized);
  return new URL('/p/' + encoded, self.location.origin).toString();
}

/**
 * Fetch event - Intercepts all network requests
 * V5: ENHANCED FIX - Aggressive iframe interception for Google Ads
 * - Top-level navigation: redirect to proxy URL (so URL bar updates)
 * - All other external requests: fetch through proxy
 * - SPECIAL HANDLING for iframe destinations (destination === 'iframe')
 * - This ensures ads, iframes, scripts, images ALL go through proxy
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = request.url;
  const destination = request.destination;
  const mode = request.mode;
  
  // Detailed logging for debugging
  console.log('[SW V5] Fetch:', {
    url: url.substring(0, 80),
    mode: mode,
    dest: destination,
    type: request.headers.get('accept')?.substring(0, 30) || 'unknown'
  });
  
  // ═══════════════════════════════════════════════════════════
  // STEP 1: Handle already-proxied requests (/p/*)
  // These are URLs that have already been converted to proxy format
  // ═══════════════════════════════════════════════════════════
  if (isProxyRequest(url)) {
    console.log('[SW V5] Handling proxy request');
    event.respondWith(handleProxyRequest(event));
    return;
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 2: Let static assets and API calls pass through
  // These are our own server resources, not external
  // ═══════════════════════════════════════════════════════════
  if (isStaticAsset(url)) {
    console.log('[SW V5] Static asset, passing through');
    return; // Default browser handling
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 3: PROXY ALL EXTERNAL URLs - This is the CRITICAL part
  // Any URL that's not from our origin MUST go through proxy
  // ═══════════════════════════════════════════════════════════
  if (isExternalUrl(url)) {
    
    // CRITICAL: ALWAYS proxy iframe destinations
    // Google Ads creates iframes dynamically, and we MUST intercept them
    // destination === 'iframe' means this is an iframe src request
    // destination === '' can also indicate iframe requests with various modes (cors, no-cors, same-origin)
    // We check for multiple modes because iframes can use different CORS policies
    if (destination === 'iframe' || (destination === '' && (mode === 'no-cors' || mode === 'cors' || mode === 'same-origin'))) {
      console.log('[SW V5] 🎯 IFRAME DETECTED - FORCING PROXY:', url.substring(0, 100));
      event.respondWith(handleExternalResource(event, url));
      return;
    }
    
    // Determine if this is a top-level navigation
    // Navigation = user clicking a link or typing in address bar
    const isNavigation = mode === 'navigate';
    
    // For navigations, we REDIRECT so the URL bar shows the proxy URL
    // This includes:
    // - User clicking external links
    // - Ad click URLs (which redirect to advertiser sites)
    // - Form submissions to external URLs
    if (isNavigation) {
      console.log('[SW V5] REDIRECT NAVIGATION:', url.substring(0, 100));
      const proxyUrl = externalToProxyUrl(url);
      event.respondWith(Response.redirect(proxyUrl, 302));
      return;
    }
    
    // For ALL other external requests, we FETCH through proxy
    // This includes (but not limited to):
    // - Iframes (Google Ads, etc.) - handled above
    // - Scripts
    // - Stylesheets  
    // - Images
    // - Fonts
    // - XHR/Fetch requests
    // - Web sockets (where possible)
    console.log('[SW V5] PROXY EXTERNAL:', destination || 'unknown', url.substring(0, 80));
    event.respondWith(handleExternalResource(event, url));
    return;
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 4: Same-origin requests pass through normally
  // These are requests to our own domain that aren't /p/* or /api/*
  // ═══════════════════════════════════════════════════════════
  console.log('[SW V5] Same-origin, passing through');
});

/**
 * Handle external resource requests (iframes, images, scripts, etc.)
 * V4: Improved error handling and header forwarding
 */
async function handleExternalResource(event, url) {
  try {
    // Convert external URL to proxy API URL
    const normalizedUrl = normalizeExternalUrl(url);
    const encoded = base64UrlEncode(normalizedUrl);
    const proxyApiUrl = new URL('/api/proxy', self.location.origin);
    proxyApiUrl.searchParams.set('url', encoded);
    
    // Build headers - forward important ones from original request
    const headers = new Headers();
    
    // Forward User-Agent
    if (event.request.headers.has('user-agent')) {
      headers.set('X-Original-UA', event.request.headers.get('user-agent'));
      headers.set('User-Agent', event.request.headers.get('user-agent'));
    }
    
    // Forward Accept headers
    if (event.request.headers.has('accept')) {
      headers.set('Accept', event.request.headers.get('accept'));
    }
    if (event.request.headers.has('accept-language')) {
      headers.set('Accept-Language', event.request.headers.get('accept-language'));
    }
    
    console.log('[SW V4] Fetching through proxy:', proxyApiUrl.toString().substring(0, 100));
    
    const response = await fetch(proxyApiUrl.toString(), {
      method: event.request.method,
      headers: headers,
      credentials: 'include' // Include cookies for session
    });
    
    // Check if response is OK
    if (!response.ok) {
      console.error('[SW V4] Proxy returned error:', response.status, 'for', url.substring(0, 60));
    }
    
    return response;
    
  } catch (error) {
    console.error('[SW V4] Proxy fetch error:', error.message, 'for', url.substring(0, 60));
    
    // Return a meaningful error response
    return new Response(
      JSON.stringify({
        error: 'Proxy Error',
        message: error.message,
        url: url.substring(0, 100)
      }),
      { 
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Handle proxy request - Forward to backend
 */
async function handleProxyRequest(event) {
  const request = event.request;
  const url = new URL(request.url);
  
  try {
    // Extract the encoded URL from path
    const encodedUrl = url.pathname.replace(/^\/p\//, '');
    
    if (!encodedUrl) {
      return new Response('Invalid proxy URL', { status: 400 });
    }
    
    // Decode to get target URL
    let targetUrl;
    try {
      targetUrl = base64UrlDecode(encodedUrl);
    } catch (e) {
      console.error('[SW] Failed to decode URL:', e);
      return new Response('Invalid encoded URL', { status: 400 });
    }
    
    console.log('[SW] Proxying:', targetUrl.substring(0, 50) + '...');
    
    // Build request to backend proxy API
    const proxyApiUrl = new URL('/api/proxy', self.location.origin);
    proxyApiUrl.searchParams.set('url', encodedUrl);
    
    // Forward relevant headers
    const headers = new Headers();
    
    // Forward User-Agent
    if (request.headers.has('user-agent')) {
      headers.set('X-Original-UA', request.headers.get('user-agent'));
    }
    
    // Forward Accept headers
    if (request.headers.has('accept')) {
      headers.set('Accept', request.headers.get('accept'));
    }
    if (request.headers.has('accept-language')) {
      headers.set('Accept-Language', request.headers.get('accept-language'));
    }
    if (request.headers.has('accept-encoding')) {
      headers.set('Accept-Encoding', request.headers.get('accept-encoding'));
    }
    
    // Make request to backend
    const response = await fetch(proxyApiUrl.toString(), {
      method: request.method,
      headers: headers,
      credentials: 'include', // Include cookies for session
    });
    
    // Return the response
    return response;
    
  } catch (error) {
    console.error('[SW] Proxy error:', error);
    return new Response(`Proxy Error: ${error.message}`, { 
      status: 502,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Handle messages from client (for future use)
 */
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};
  
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW V5] Service Worker loaded - Enhanced iframe interception enabled');

