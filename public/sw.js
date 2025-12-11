/**
 * Service Worker - Proxy Interception
 * 
 * Intercepts all network requests and routes /p/* requests through the backend proxy.
 * Handles session management and request forwarding.
 * 
 * Version: 2 - Fixed proxy endpoint from /api/proxy to /proxy
 */

// Cache name for any cached assets
// V3: Fixed iframe handling - proxy instead of redirect
const CACHE_NAME = 'proxy-poc-v3';

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
 * V3: Fixed to properly handle iframe requests - proxy them instead of redirect
 * CRITICAL: Iframes should NOT be redirected, they should be proxied directly
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = request.url;
  
  console.log('[SW] Fetch event:', url.substring(0, 60), 'mode:', request.mode, 'dest:', request.destination);
  
  // Check if this is a proxy request (/p/*)
  if (isProxyRequest(url)) {
    console.log('[SW] Intercepting proxy request');
    event.respondWith(handleProxyRequest(event));
    return;
  }
  
  // For static assets and API calls, let them pass through normally
  if (isStaticAsset(url)) {
    console.log('[SW] Static asset, passing through');
    return; // Default browser handling
  }
  
  // ═══════════════════════════════════════════════════════════
  // CRITICAL FIX V3: Handle all external URLs appropriately
  // - Document navigations: redirect to proxy URL
  // - Iframes: fetch through proxy (NOT redirect - this breaks iframes!)
  // - Other resources: fetch through proxy
  // ═══════════════════════════════════════════════════════════
  if (isExternalUrl(url)) {
    
    // Check for Google ad click URLs specifically (these are navigation clicks)
    const isAdClickUrl = url.includes('googleadservices.com/pagead/aclk') ||
                        url.includes('googleads.g.doubleclick.net/dbm/clk') ||
                        url.includes('doubleclick.net/pcs/click') ||
                        url.includes('/pagead/aclk');
    
    // Check for Google Ad domains (iframe content and resources)
    const isGoogleAdDomain = url.includes('googleads.g.doubleclick.net') ||
                            url.includes('pagead2.googlesyndication.com') ||
                            url.includes('tpc.googlesyndication.com') ||
                            url.includes('securepubads.g.doubleclick.net') ||
                            url.includes('adtrafficquality.google') ||
                            url.includes('googlesyndication.com');
    
    // Determine request type
    const isDocumentNavigation = request.mode === 'navigate' && request.destination === 'document';
    const isIframeRequest = request.destination === 'iframe';
    
    // ═══════════════════════════════════════════════════════════
    // CASE 1: Top-level document navigation (user clicking links)
    // Use redirect so URL bar updates correctly
    // ═══════════════════════════════════════════════════════════
    if (isDocumentNavigation || isAdClickUrl) {
      console.log('[SW] REDIRECTING TOP-LEVEL NAVIGATION:', url.substring(0, 80));
      const proxyUrl = externalToProxyUrl(url);
      event.respondWith(Response.redirect(proxyUrl, 302));
      return;
    }
    
    // ═══════════════════════════════════════════════════════════
    // CASE 2: Iframe requests - MUST proxy content, NOT redirect!
    // Redirecting iframes breaks them. We need to fetch content
    // through proxy and return it so our scripts get injected.
    // ═══════════════════════════════════════════════════════════
    if (isIframeRequest) {
      console.log('[SW] PROXYING IFRAME REQUEST:', url.substring(0, 80));
      event.respondWith(handleExternalResource(event, url));
      return;
    }
    
    // ═══════════════════════════════════════════════════════════
    // CASE 3: Google Ad domain resources (scripts, images, etc.)
    // Proxy to maintain session and inject our scripts
    // ═══════════════════════════════════════════════════════════
    if (isGoogleAdDomain) {
      console.log('[SW] PROXYING GOOGLE AD RESOURCE:', url.substring(0, 60));
      event.respondWith(handleExternalResource(event, url));
      return;
    }
    
    // ═══════════════════════════════════════════════════════════
    // CASE 4: All other external resources (images, scripts, etc.)
    // Proxy to maintain anonymity
    // ═══════════════════════════════════════════════════════════
    console.log('[SW] PROXYING EXTERNAL RESOURCE:', url.substring(0, 60));
    event.respondWith(handleExternalResource(event, url));
    return;
  }
  
  // For any other same-origin requests, pass through
  console.log('[SW] Other request, passing through');
});

/**
 * Handle external resource requests (images, scripts, etc.)
 */
async function handleExternalResource(event, url) {
  try {
    // Convert to proxy URL and fetch
    const normalizedUrl = normalizeExternalUrl(url);
    const encoded = base64UrlEncode(normalizedUrl);
    const proxyApiUrl = new URL('/api/proxy', self.location.origin);
    proxyApiUrl.searchParams.set('url', encoded);
    
    const response = await fetch(proxyApiUrl.toString(), {
      method: event.request.method,
      headers: event.request.headers,
      credentials: 'include'
    });
    
    return response;
  } catch (error) {
    console.error('[SW] External resource proxy error:', error);
    return new Response('Proxy Error: ' + error.message, { status: 502 });
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

console.log('[SW] Service Worker loaded');

