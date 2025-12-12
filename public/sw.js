/**
 * Service Worker - Proxy Interception
 * 
 * Intercepts all network requests and routes /p/* requests through the backend proxy.
 * Handles session management and request forwarding.
 * 
 * Version: 7 - BULLETPROOF EDITION
 * - Enhanced iframe interception for Google Ads
 * - Better document/navigate mode handling for nested iframes
 * - Explicit handling for all Google ad domains
 * - Improved logging for debugging bypass issues
 */

// FORCE UPDATE: Version with timestamp to bypass browser cache
const SW_VERSION = 'v7-2024-12-12-bulletproof';
const CACHE_NAME = 'proxy-poc-v7-' + Date.now();

// Google ad domains that MUST be proxied
const GOOGLE_AD_DOMAINS = [
  'googleads.g.doubleclick.net',
  'pagead2.googlesyndication.com',
  'securepubads.g.doubleclick.net',
  'tpc.googlesyndication.com',
  'googleadservices.com',
  'www.googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'adtrafficquality.google',
  'ep1.adtrafficquality.google',
  'ep2.adtrafficquality.google'
];

/**
 * Check if URL is from Google ad domain
 */
function isGoogleAdUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    return GOOGLE_AD_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch(e) {
    return false;
  }
}

/**
 * Install event - Called when SW is first installed
 */
self.addEventListener('install', (event) => {
  console.log(`[SW ${SW_VERSION}] Installing... FORCING IMMEDIATE ACTIVATION`);
  
  // Skip waiting to activate immediately - FORCE UPDATE
  self.skipWaiting();
});

/**
 * Activate event - Called when SW becomes active
 */
self.addEventListener('activate', (event) => {
  console.log(`[SW ${SW_VERSION}] ✅ ACTIVATED - ENHANCED IFRAME INTERCEPTION READY`);
  
  // Claim all clients immediately (don't wait for refresh)
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[SW ${SW_VERSION}] Clearing old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log(`[SW ${SW_VERSION}] Claiming all clients`);
      return clients.claim();
    })
  );
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
  
  // ENHANCED logging - log EVERYTHING for debugging
  const requestInfo = {
    url: url.substring(0, 100),
    mode: mode,
    dest: destination,
    type: request.headers.get('accept')?.substring(0, 40) || 'unknown',
    referrer: request.referrer?.substring(0, 60) || 'none'
  };
  console.log(`[SW ${SW_VERSION}] 📥 FETCH:`, requestInfo);
  
  // ═══════════════════════════════════════════════════════════
  // STEP 1: Handle already-proxied requests (/p/*)
  // These are URLs that have already been converted to proxy format
  // ═══════════════════════════════════════════════════════════
  if (isProxyRequest(url)) {
    console.log(`[SW ${SW_VERSION}] ✓ Handling proxy request`);
    event.respondWith(handleProxyRequest(event));
    return;
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 2: Let static assets and API calls pass through
  // These are our own server resources, not external
  // ═══════════════════════════════════════════════════════════
  if (isStaticAsset(url)) {
    console.log(`[SW ${SW_VERSION}] ✓ Static asset, passing through:`, url.substring(0, 60));
    return; // Default browser handling
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 3: PROXY ALL EXTERNAL URLs - This is the CRITICAL part
  // Any URL that's not from our origin MUST go through proxy
  // ═══════════════════════════════════════════════════════════
  if (isExternalUrl(url)) {
    
    // ═══════════════════════════════════════════════════════════
    // BULLETPROOF FIX: Check for Google Ad URLs FIRST
    // These MUST ALWAYS be proxied, never redirected
    // ═══════════════════════════════════════════════════════════
    if (isGoogleAdUrl(url)) {
      console.log(`[SW ${SW_VERSION}] 🎯 GOOGLE AD URL DETECTED - FORCING PROXY:`, url.substring(0, 100));
      event.respondWith(handleExternalResource(event, url));
      return;
    }
    
    // ═══════════════════════════════════════════════════════════
    // CRITICAL FIX: Check iframe destination FIRST before anything else
    // Google Ad iframes have destination === 'iframe' with mode === 'navigate'
    // We MUST proxy them, not redirect them!
    // ═══════════════════════════════════════════════════════════
    if (destination === 'iframe') {
      console.log(`[SW ${SW_VERSION}] 🎯 IFRAME DETECTED (dest=iframe, mode=${mode}) - FORCING PROXY:`, url.substring(0, 100));
      event.respondWith(handleExternalResource(event, url));
      return;
    }
    
    // ═══════════════════════════════════════════════════════════
    // BULLETPROOF FIX: Handle document destination with navigate mode
    // This could be a nested iframe navigation - check referrer
    // ═══════════════════════════════════════════════════════════
    if (destination === 'document' && mode === 'navigate') {
      const referrer = request.referrer;
      // If referrer is from our proxy domain, this is likely an iframe navigation
      if (referrer && referrer.includes(self.location.origin)) {
        console.log(`[SW ${SW_VERSION}] 🎯 NESTED DOCUMENT NAVIGATION (from proxy) - PROXYING:`, url.substring(0, 100));
        event.respondWith(handleExternalResource(event, url));
        return;
      }
    }
    
    // Also catch iframes with empty destination (some browsers)
    if (destination === '' && (mode === 'no-cors' || mode === 'cors' || mode === 'same-origin')) {
      console.log(`[SW ${SW_VERSION}] 🎯 RESOURCE DETECTED (dest='', mode=${mode}) - FORCING PROXY:`, url.substring(0, 100));
      event.respondWith(handleExternalResource(event, url));
      return;
    }
    
    // ═══════════════════════════════════════════════════════════
    // Handle empty destination with navigate mode - could be iframe
    // ═══════════════════════════════════════════════════════════
    if (destination === '' && mode === 'navigate') {
      // Check if this looks like it's from an ad context
      const referrer = request.referrer;
      if (referrer && (referrer.includes('/p/') || referrer.includes('googlesyndication') || referrer.includes('doubleclick'))) {
        console.log(`[SW ${SW_VERSION}] 🎯 NAVIGATE WITH EMPTY DEST (ad context) - PROXYING:`, url.substring(0, 100));
        event.respondWith(handleExternalResource(event, url));
        return;
      }
    }
    
    // Determine if this is a top-level navigation (NOT iframe navigation)
    // Navigation = user clicking a link or typing in address bar
    // At this point, we've already handled iframe navigations above
    const isNavigation = mode === 'navigate';
    
    // For TOP-LEVEL navigations only, we REDIRECT so the URL bar shows the proxy URL
    // This includes:
    // - User clicking external links
    // - Ad click URLs (which redirect to advertiser sites)
    // - Form submissions to external URLs
    if (isNavigation) {
      console.log(`[SW ${SW_VERSION}] 🔄 TOP-LEVEL NAVIGATION - REDIRECTING:`, url.substring(0, 100));
      const proxyUrl = externalToProxyUrl(url);
      event.respondWith(Response.redirect(proxyUrl, 302));
      return;
    }
    
    // For ALL other external requests, we FETCH through proxy
    // This includes (but not limited to):
    // - Scripts
    // - Stylesheets  
    // - Images
    // - Fonts
    // - XHR/Fetch requests
    // - Web sockets (where possible)
    console.log(`[SW ${SW_VERSION}] 📡 PROXY EXTERNAL (dest=${destination}, mode=${mode}):`, url.substring(0, 80));
    event.respondWith(handleExternalResource(event, url));
    return;
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 4: Same-origin requests pass through normally
  // These are requests to our own domain that aren't /p/* or /api/*
  // ═══════════════════════════════════════════════════════════
  console.log(`[SW ${SW_VERSION}] ✓ Same-origin, passing through:`, url.substring(0, 80));
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
 * Check if a string looks like a valid base64 encoded URL
 */
function isValidBase64Url(str) {
  if (!str || str.length < 10) return false;
  // Valid base64 URL chars: a-z, A-Z, 0-9, -, _
  if (!/^[a-zA-Z0-9\-_]+$/.test(str)) return false;
  // Should not look like a file path (no dots unless in base64)
  if (str.includes('.') && !str.includes('_') && str.length < 20) return false;
  return true;
}

/**
 * Store for last known original URL (for resolving relative paths)
 */
let lastKnownOriginalUrl = null;

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
    let actualEncodedUrl = encodedUrl;
    
    // Check if it looks like valid base64
    if (isValidBase64Url(encodedUrl)) {
      try {
        targetUrl = base64UrlDecode(encodedUrl);
        // Store as last known URL if it's a valid page URL
        if (targetUrl.endsWith('.html') || targetUrl.endsWith('/') || !targetUrl.includes('.')) {
          lastKnownOriginalUrl = targetUrl;
        }
      } catch (e) {
        console.error('[SW] Failed to decode URL:', e);
        targetUrl = null;
      }
    }
    
    // If decoding failed or it's not valid base64, try to resolve as relative URL
    if (!targetUrl) {
      console.log(`[SW ${SW_VERSION}] Malformed proxy URL detected:`, encodedUrl);
      
      // Try to resolve against last known original URL
      if (lastKnownOriginalUrl) {
        try {
          const baseUrl = new URL(lastKnownOriginalUrl);
          // Get base path (remove filename if present)
          let basePath = baseUrl.href;
          if (!basePath.endsWith('/')) {
            basePath = basePath.substring(0, basePath.lastIndexOf('/') + 1);
          }
          targetUrl = new URL(encodedUrl, basePath).href;
          actualEncodedUrl = base64UrlEncode(targetUrl);
          console.log(`[SW ${SW_VERSION}] Resolved malformed URL: ${encodedUrl} -> ${targetUrl}`);
        } catch (resolveErr) {
          console.error('[SW] Failed to resolve relative URL:', resolveErr);
          return new Response(`Invalid proxy URL: ${encodedUrl}. Unable to resolve as relative path.`, { 
            status: 400,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
      } else {
        // No last known URL - can't resolve
        console.error('[SW] No last known URL to resolve against');
        return new Response(`Invalid proxy URL: ${encodedUrl}. No context to resolve relative path.`, { 
          status: 400,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    }
    
    console.log('[SW] Proxying:', targetUrl.substring(0, 50) + '...');
    
    // Build request to backend proxy API
    const proxyApiUrl = new URL('/api/proxy', self.location.origin);
    proxyApiUrl.searchParams.set('url', actualEncodedUrl);
    
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
    console.log(`[SW ${SW_VERSION}] Force update requested`);
    self.skipWaiting();
  }
});

console.log(`[SW ${SW_VERSION}] ✅ Service Worker LOADED - Enhanced iframe interception ENABLED`);

