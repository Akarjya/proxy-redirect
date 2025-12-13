/**
 * HTML Processor Service
 * 
 * Parses HTML, rewrites URLs, and injects scripts.
 * Handles all URL attributes (href, src, srcset, action, data, etc.)
 */

const cheerio = require('cheerio');
const base64Url = require('../utils/base64Url');
const cssProcessor = require('./cssProcessor');
const { URL } = require('url');

// Elements and their URL attributes to rewrite
const URL_ATTRIBUTES = {
  'a': ['href'],
  'link': ['href'],
  'script': ['src'],
  'img': ['src', 'srcset'],
  'video': ['src', 'poster'],
  'audio': ['src'],
  'source': ['src', 'srcset'],
  'iframe': ['src'],
  'embed': ['src'],
  'object': ['data'],
  'form': ['action'],
  'input': ['src'], // for type="image"
  'track': ['src'],
  'area': ['href'],
};

// Data attributes that commonly contain URLs and need to be rewritten
const DATA_URL_ATTRIBUTES = [
  'data-href',
  'data-src',
  'data-url',
  'data-link',
  'data-target',
  'data-action',
  'data-background',
  'data-image',
  'data-poster',
  'data-lazy-src',
  'data-srcset',
  'data-original',
];

// URLs to skip (not proxy)
function shouldSkipUrl(url) {
  if (!url) return true;
  
  const trimmed = url.trim();
  
  return (
    trimmed === '' ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('about:') ||
    trimmed.startsWith('/p/') // Already proxied
  );
}

/**
 * Resolve relative URL against base URL
 * @param {string} url - URL to resolve
 * @param {string} baseUrl - Base URL
 * @returns {string}
 */
function resolveUrl(url, baseUrl) {
  if (!url || shouldSkipUrl(url)) return url;
  
  // Trim whitespace
  url = url.trim();
  
  try {
    // Handle protocol-relative URLs
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    
    // If already absolute, return as-is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // Ensure baseUrl is valid for resolution
    if (!baseUrl || !baseUrl.startsWith('http')) {
      console.warn('[htmlProcessor] Invalid baseUrl for resolution:', baseUrl, 'url:', url);
      return url;
    }
    
    // Resolve relative URL
    const resolved = new URL(url, baseUrl).href;
    return resolved;
  } catch (e) {
    console.warn('[htmlProcessor] URL resolution failed:', url, 'baseUrl:', baseUrl, 'error:', e.message);
    return url;
  }
}

/**
 * Convert URL to proxy URL
 * @param {string} absoluteUrl - Absolute URL (or relative URL if baseUrl provided)
 * @param {string} [baseUrl] - Optional base URL for resolving relative URLs
 * @returns {string}
 */
function toProxyUrl(absoluteUrl, baseUrl) {
  if (!absoluteUrl || shouldSkipUrl(absoluteUrl)) {
    return absoluteUrl;
  }
  
  // Trim whitespace
  absoluteUrl = absoluteUrl.trim();
  
  // If URL is relative (doesn't start with http), try to resolve it
  if (!absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
    if (baseUrl && baseUrl.startsWith('http')) {
      try {
        // Resolve relative URL against base URL
        absoluteUrl = new URL(absoluteUrl, baseUrl).href;
      } catch (e) {
        // If resolution fails and no absolute URL, return original
        // This will make browser resolve it against current page (which may be wrong)
        console.warn('[htmlProcessor] Failed to resolve relative URL:', absoluteUrl, 'baseUrl:', baseUrl);
        return absoluteUrl;
      }
    } else {
      // No valid base URL provided and URL is relative - can't encode properly
      console.warn('[htmlProcessor] Relative URL without valid baseUrl:', absoluteUrl, 'baseUrl:', baseUrl);
      return absoluteUrl;
    }
  }
  
  return base64Url.toProxyPath(absoluteUrl);
}

/**
 * Rewrite srcset attribute (contains multiple URLs with sizes)
 * Format: "url1 1x, url2 2x" or "url1 100w, url2 200w"
 * @param {string} srcset - Original srcset value
 * @param {string} baseUrl - Base URL for resolution
 * @returns {string}
 */
function rewriteSrcset(srcset, baseUrl) {
  if (!srcset) return srcset;
  
  return srcset.split(',').map(entry => {
    const parts = entry.trim().split(/\s+/);
    if (parts.length >= 1) {
      const url = parts[0];
      const resolved = resolveUrl(url, baseUrl);
      // Pass baseUrl as fallback in case resolved is still relative
      const proxied = toProxyUrl(resolved, baseUrl);
      parts[0] = proxied;
    }
    return parts.join(' ');
  }).join(', ');
}

/**
 * Get WebRTC blocking script content
 * @returns {string}
 */
function getWebRtcBlockScript() {
  return `
(function() {
  'use strict';
  
  // Fake RTCPeerConnection class that does nothing
  function FakeRTCPeerConnection(config) {
    this.localDescription = null;
    this.remoteDescription = null;
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
    this.iceGatheringState = 'complete';
    this.signalingState = 'closed';
    
    // Event handlers (never called)
    this.onicecandidate = null;
    this.ontrack = null;
    this.ondatachannel = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.onicegatheringstatechange = null;
    this.onsignalingstatechange = null;
    this.onnegotiationneeded = null;
  }
  
  // All methods return resolved promises or do nothing
  FakeRTCPeerConnection.prototype.createOffer = function() { return Promise.resolve(null); };
  FakeRTCPeerConnection.prototype.createAnswer = function() { return Promise.resolve(null); };
  FakeRTCPeerConnection.prototype.setLocalDescription = function() { return Promise.resolve(); };
  FakeRTCPeerConnection.prototype.setRemoteDescription = function() { return Promise.resolve(); };
  FakeRTCPeerConnection.prototype.addIceCandidate = function() { return Promise.resolve(); };
  FakeRTCPeerConnection.prototype.createDataChannel = function() { return { close: function() {} }; };
  FakeRTCPeerConnection.prototype.addTrack = function() { return null; };
  FakeRTCPeerConnection.prototype.removeTrack = function() {};
  FakeRTCPeerConnection.prototype.close = function() {};
  FakeRTCPeerConnection.prototype.getStats = function() { return Promise.resolve(new Map()); };
  FakeRTCPeerConnection.prototype.getSenders = function() { return []; };
  FakeRTCPeerConnection.prototype.getReceivers = function() { return []; };
  FakeRTCPeerConnection.prototype.getTransceivers = function() { return []; };
  FakeRTCPeerConnection.prototype.addTransceiver = function() { return null; };
  FakeRTCPeerConnection.generateCertificate = function() { return Promise.resolve({}); };
  
  // Override with non-configurable property
  try {
    Object.defineProperty(window, 'RTCPeerConnection', {
      value: FakeRTCPeerConnection,
      writable: false,
      configurable: false
    });
    Object.defineProperty(window, 'webkitRTCPeerConnection', {
      value: FakeRTCPeerConnection,
      writable: false,
      configurable: false
    });
    Object.defineProperty(window, 'mozRTCPeerConnection', {
      value: FakeRTCPeerConnection,
      writable: false,
      configurable: false
    });
  } catch(e) {}
  
  // Override RTCSessionDescription and RTCIceCandidate
  function FakeRTCSessionDescription() {}
  function FakeRTCIceCandidate() {}
  
  try {
    Object.defineProperty(window, 'RTCSessionDescription', {
      value: FakeRTCSessionDescription,
      writable: false,
      configurable: false
    });
    Object.defineProperty(window, 'RTCIceCandidate', {
      value: FakeRTCIceCandidate,
      writable: false,
      configurable: false
    });
  } catch(e) {}
  
  // Override getUserMedia
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = function() {
      return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    };
    navigator.mediaDevices.enumerateDevices = function() {
      return Promise.resolve([]);
    };
  }
  
  if (navigator.getUserMedia) {
    navigator.getUserMedia = function(constraints, success, error) {
      error(new DOMException('Permission denied', 'NotAllowedError'));
    };
  }
  
  console.log('[Proxy] WebRTC blocked');
  
  // ═══════════════════════════════════════════════════════════
  // WEBSOCKET OVERRIDE - Intercept and proxy WebSocket connections
  // WebSockets can bypass proxy, so we need to handle them
  // ═══════════════════════════════════════════════════════════
  (function() {
    var OriginalWebSocket = window.WebSocket;
    var proxyOrigin = window.location.origin;
    
    // Helper to check if WebSocket URL is external
    function isExternalWsUrl(url) {
      try {
        var wsUrl = new URL(url);
        var httpOrigin = wsUrl.protocol === 'wss:' ? 'https://' : 'http://';
        httpOrigin += wsUrl.host;
        return httpOrigin !== proxyOrigin;
      } catch(e) {
        return false;
      }
    }
    
    // Helper to convert ws/wss to http/https for logging
    function wsToHttp(url) {
      return url.replace('wss://', 'https://').replace('ws://', 'http://');
    }
    
    // Override WebSocket constructor
    window.WebSocket = function(url, protocols) {
      // Log the connection attempt
      console.log('[Proxy] WebSocket connection attempt:', url);
      
      // If it's an external WebSocket, we can't proxy it through HTTP
      // Options: 1) Block it, 2) Allow direct connection (IP leak risk)
      // For security, we log a warning but allow the connection
      // A more secure approach would be to set up a WebSocket proxy
      if (isExternalWsUrl(url)) {
        console.warn('[Proxy] External WebSocket detected:', url.substring(0, 60));
        console.warn('[Proxy] WebSocket connections may bypass proxy - potential IP leak');
        // For now, allow the connection but log it
        // To block: throw new Error('External WebSocket blocked for security');
      }
      
      // Create the WebSocket with original constructor
      if (protocols !== undefined) {
        return new OriginalWebSocket(url, protocols);
      }
      return new OriginalWebSocket(url);
    };
    
    // Copy static properties
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    
    console.log('[Proxy] WebSocket override active');
  })();
})();
`;
}

/**
 * Get Fetch/XHR override script content
 * @param {string} originalUrl - The original target URL for spoofing
 * @returns {string}
 */
function getFetchOverrideScript(originalUrl) {
  return `
(function() {
  'use strict';
  
  // Store real location FIRST before anything else
  var __realLocation__ = window.location;
  var __realOrigin__ = __realLocation__.origin;
  
  // ═══════════════════════════════════════════════════════════
  // CRITICAL: DOCUMENT.WRITE OVERRIDE - MUST BE FIRST!
  // Google Ads uses document.write to inject iframe content synchronously
  // ═══════════════════════════════════════════════════════════
  (function() {
    var originalWrite = document.write.bind(document);
    var originalWriteln = document.writeln.bind(document);
    
    function quickBase64Encode(str) {
      try {
        var base64 = btoa(unescape(encodeURIComponent(str)));
        return base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
      } catch(e) { return null; }
    }
    
    function isExternalUrl(url) {
      if (!url) return false;
      if (url.startsWith('//')) url = 'https:' + url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
      try {
        return new URL(url).origin !== __realOrigin__;
      } catch(e) { return false; }
    }
    
    function rewriteHtmlContent(html) {
      if (!html || typeof html !== 'string') return html;
      // Rewrite iframe src
      html = html.replace(/(<iframe[^>]*\\s+src\\s*=\\s*["'])([^"']+)(["'])/gi, function(m, p, url, s) {
        if (url.startsWith('//')) url = 'https:' + url;
        if (isExternalUrl(url) && !url.includes('/p/')) {
          var enc = quickBase64Encode(url);
          if (enc) { console.log('[Proxy] document.write: iframe proxied'); return p + '/p/' + enc + s; }
        }
        return m;
      });
      // Rewrite script src
      html = html.replace(/(<script[^>]*\\s+src\\s*=\\s*["'])([^"']+)(["'])/gi, function(m, p, url, s) {
        if (url.startsWith('//')) url = 'https:' + url;
        if (isExternalUrl(url) && !url.includes('/p/')) {
          var enc = quickBase64Encode(url);
          if (enc) return p + '/p/' + enc + s;
        }
        return m;
      });
      return html;
    }
    
    document.write = function() {
      var args = Array.prototype.slice.call(arguments);
      return originalWrite.apply(document, args.map(rewriteHtmlContent));
    };
    document.writeln = function() {
      var args = Array.prototype.slice.call(arguments);
      return originalWriteln.apply(document, args.map(rewriteHtmlContent));
    };
    console.log('[Proxy] document.write/writeln OVERRIDDEN');
  })();
  
  // ═══════════════════════════════════════════════════════════
  // ORIGINAL URL FOR LOCATION SPOOFING
  // ═══════════════════════════════════════════════════════════
  var ORIGINAL_URL = ${originalUrl ? `'${originalUrl}'` : 'null'};
  var ORIGINAL_URL_OBJ = null;
  
  if (ORIGINAL_URL) {
    try { ORIGINAL_URL_OBJ = new URL(ORIGINAL_URL); } catch(e) {}
  }
  
  // Spoof document.URL for Google Ads
  if (ORIGINAL_URL) {
    try {
      Object.defineProperty(document, 'URL', {
        get: function() { return ORIGINAL_URL; },
        configurable: true
      });
    } catch(e) {}
    
    try {
      Object.defineProperty(document, 'documentURI', {
        get: function() { return ORIGINAL_URL; },
        configurable: true
      });
    } catch(e) {}
    
    try {
      Object.defineProperty(document, 'baseURI', {
        get: function() { return ORIGINAL_URL; },
        configurable: true
      });
    } catch(e) {}
    
    if (ORIGINAL_URL_OBJ) {
      try {
        Object.defineProperty(document, 'domain', {
          get: function() { return ORIGINAL_URL_OBJ.hostname; },
          set: function() {},
          configurable: true
        });
      } catch(e) {}
    }
    
    try {
      Object.defineProperty(document, 'referrer', {
        get: function() { return ORIGINAL_URL_OBJ ? ORIGINAL_URL_OBJ.origin + '/' : ''; },
        configurable: true
      });
    } catch(e) {}
  }
  
  // ═══════════════════════════════════════════════════════════
  // NAVIGATION INTERCEPTION
  // ═══════════════════════════════════════════════════════════
  
  // __realLocation__ and __realOrigin__ already defined above
  
  // ═══════════════════════════════════════════════════════════
  // CRITICAL: INTERCEPT EXTERNAL NAVIGATION VIA BEFOREUNLOAD
  // This catches ALL navigation attempts including top.location.href
  // ═══════════════════════════════════════════════════════════
  var __pendingExternalNav__ = null;
  
  // Monitor for external navigation attempts
  window.addEventListener('beforeunload', function(e) {
    // Check if we're navigating to an external URL
    // This is a last-ditch effort to catch navigations we missed
    console.log('[Proxy] Page unload event triggered');
  }, false);
  
  // Use a MutationObserver on the document to detect when a navigation is about to happen
  // by watching for script-initiated location changes
  (function() {
    var checkInterval = setInterval(function() {
      // Get the pending navigation URL if any
      try {
        var pendingUrl = document.activeElement && document.activeElement.href;
        if (pendingUrl && !pendingUrl.includes('/p/') && !pendingUrl.includes('/external/')) {
          var urlObj = new URL(pendingUrl);
          if (urlObj.origin !== __realOrigin__) {
            console.log('[Proxy] Detected pending navigation to:', pendingUrl.substring(0, 60));
          }
        }
      } catch(e) {}
    }, 100);
    
    // Clear after 30 seconds to avoid memory leak
    setTimeout(function() { clearInterval(checkInterval); }, 30000);
  })();
  
  function base64UrlEncode(str) {
    var base64 = btoa(unescape(encodeURIComponent(str)));
    return base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }

  // Normalize protocol-relative URLs by adding the current page protocol
  function normalizeUrl(url) {
    if (!url) return url;
    if (typeof url === 'string' && url.startsWith('//')) {
      return (window.location.protocol || 'https:') + url;
    }
    return url;
  }
  
  function shouldProxy(url) {
    if (!url) return false;
    if (typeof url !== 'string') {
      if (url instanceof URL) url = url.href;
      else if (url instanceof Request) url = url.url;
      else return false;
    }
    url = normalizeUrl(url);
    if (url.includes('/p/')) return false;
    if (url.includes('/external/')) return false;
    if (url.startsWith('data:')) return false;
    if (url.startsWith('blob:')) return false;
    if (url.startsWith('javascript:')) return false;
    if (!url.includes('://')) return false;
    try {
      var urlObj = new URL(url);
      // Use stored real origin for comparison
      if (urlObj.origin === __realOrigin__) return false;
    } catch(e) {}
    return true;
  }
  
  function toProxyUrl(url) {
    url = normalizeUrl(url);
    return '/p/' + base64UrlEncode(url);
  }
  
  // ═══════════════════════════════════════════════════════════
  // WINDOW.LOCATION SPOOFING (CRITICAL FOR REDIRECT PREVENTION)
  // ═══════════════════════════════════════════════════════════
  if (ORIGINAL_URL && ORIGINAL_URL_OBJ) {
    // Create a fake location-like object
    var fakeLocation = {
      get href() { return ORIGINAL_URL; },
      set href(url) { 
        if (shouldProxy(url)) url = toProxyUrl(url);
        __realLocation__.href = url; 
      },
      get protocol() { return ORIGINAL_URL_OBJ.protocol; },
      get host() { return ORIGINAL_URL_OBJ.host; },
      get hostname() { return ORIGINAL_URL_OBJ.hostname; },
      get port() { return ORIGINAL_URL_OBJ.port; },
      get pathname() { return ORIGINAL_URL_OBJ.pathname; },
      get search() { return ORIGINAL_URL_OBJ.search; },
      get hash() { return ORIGINAL_URL_OBJ.hash; },
      get origin() { return ORIGINAL_URL_OBJ.origin; },
      assign: function(url) {
        if (shouldProxy(url)) url = toProxyUrl(url);
        __realLocation__.assign(url);
      },
      replace: function(url) {
        if (shouldProxy(url)) url = toProxyUrl(url);
        __realLocation__.replace(url);
      },
      reload: function() { __realLocation__.reload(); },
      toString: function() { return ORIGINAL_URL; }
    };
    
    // Try to override window.location (may not work in all browsers)
    try {
      Object.defineProperty(window, 'location', {
        get: function() { return fakeLocation; },
        set: function(url) { 
          if (shouldProxy(url)) url = toProxyUrl(url);
          __realLocation__.href = url;
        },
        configurable: false
      });
      console.log('[Proxy] window.location spoofed successfully');
    } catch(e) {
      // If we can't override window.location, try alternative methods
      console.log('[Proxy] Could not override window.location: ' + e.message);
    }
    
    // Also try to override self.location
    try {
      Object.defineProperty(self, 'location', {
        get: function() { return fakeLocation; },
        set: function(url) { 
          if (shouldProxy(url)) url = toProxyUrl(url);
          __realLocation__.href = url;
        },
        configurable: false
      });
    } catch(e) {}
    
    // Override location on document as well
    try {
      Object.defineProperty(document, 'location', {
        get: function() { return fakeLocation; },
        set: function(url) { 
          if (shouldProxy(url)) url = toProxyUrl(url);
          __realLocation__.href = url;
        },
        configurable: true
      });
    } catch(e) {}
  }
  
  // ═══════════════════════════════════════════════════════════
  // GOOGLE ADS URL REWRITING
  // ═══════════════════════════════════════════════════════════
  var adDomains = ['googleads.g.doubleclick.net', 'pagead2.googlesyndication.com', 'googleadservices.com'];
  
  function isAdUrl(url) {
    try {
      var hostname = new URL(url).hostname;
      return adDomains.some(function(d) { return hostname.includes(d); });
    } catch(e) { return false; }
  }
  
  function rewriteAdUrl(adUrl) {
    if (!isAdUrl(adUrl)) return adUrl;
    try {
      var urlObj = new URL(adUrl);
      // If we have ORIGINAL_URL, rewrite the 'url' parameter to show original page
      if (ORIGINAL_URL) {
        var urlParam = urlObj.searchParams.get('url');
        if (urlParam && (urlParam.includes('/p/') || urlParam.includes(window.location.origin))) {
          urlObj.searchParams.set('url', ORIGINAL_URL);
        }
      }
      // CRITICAL: Convert ad URL to proxy URL so it loads through our server
      return toProxyUrl(urlObj.toString());
    } catch(e) {}
    // Fallback: still proxy the ad URL even if modification fails
    return toProxyUrl(adUrl);
  }
  
  // ═══════════════════════════════════════════════════════════
  // FETCH OVERRIDE
  // ═══════════════════════════════════════════════════════════
  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    var url;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else if (input instanceof Request) url = input.url;
    
    if (shouldProxy(url)) {
      var proxyUrl = toProxyUrl(url);
      if (input instanceof Request) input = new Request(proxyUrl, input);
      else input = proxyUrl;
    }
    return originalFetch.call(this, input, init);
  };
  
  // ═══════════════════════════════════════════════════════════
  // XMLHttpRequest OVERRIDE
  // ═══════════════════════════════════════════════════════════
  var originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (shouldProxy(url)) arguments[1] = toProxyUrl(url);
    return originalXHROpen.apply(this, arguments);
  };
  
  // ═══════════════════════════════════════════════════════════
  // IFRAME SRC OVERRIDE (for Google Ads)
  // ═══════════════════════════════════════════════════════════
  try {
    var iframeDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (iframeDescriptor && iframeDescriptor.set) {
      var originalIframeSrcSetter = iframeDescriptor.set;
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        get: iframeDescriptor.get,
        set: function(value) {
          if (value && isAdUrl(value)) {
            console.log('[Proxy] Intercepting ad iframe src:', value.substring(0, 60));
            value = rewriteAdUrl(value);
          } else if (shouldProxy(value)) {
            console.log('[Proxy] Proxying external iframe src:', value.substring(0, 60));
            value = toProxyUrl(value);
          }
          return originalIframeSrcSetter.call(this, value);
        },
        configurable: true,
        enumerable: iframeDescriptor.enumerable
      });
    }
  } catch(e) { console.log('[Proxy] Could not override iframe src:', e.message); }
  
  // Override setAttribute for iframes
  var originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (this.tagName === 'IFRAME' && name.toLowerCase() === 'src') {
      if (value && isAdUrl(value)) {
        console.log('[Proxy] setAttribute: Rewriting ad iframe src');
        value = rewriteAdUrl(value);
      } else if (shouldProxy(value)) {
        console.log('[Proxy] setAttribute: Proxying external iframe src');
        value = toProxyUrl(value);
      }
    }
    return originalSetAttribute.call(this, name, value);
  };
  
  // ═══════════════════════════════════════════════════════════
  // OTHER ELEMENT OVERRIDES
  // ═══════════════════════════════════════════════════════════
  function overrideElementProperty(prototype, property) {
    var descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (!descriptor || !descriptor.set) return;
    var originalSetter = descriptor.set;
    Object.defineProperty(prototype, property, {
      get: descriptor.get,
      set: function(value) {
        if (shouldProxy(value)) value = toProxyUrl(value);
        return originalSetter.call(this, value);
      },
      configurable: true
    });
  }
  
  try { overrideElementProperty(HTMLImageElement.prototype, 'src'); } catch(e) {}
  try { overrideElementProperty(HTMLScriptElement.prototype, 'src'); } catch(e) {}
  
  // ═══════════════════════════════════════════════════════════
  // LOCATION OVERRIDE - Using safer approach
  // Modern browsers don't allow defineProperty on location
  // So we rely on Service Worker and click interception instead
  // ═══════════════════════════════════════════════════════════
  (function() {
    try {
      var _assign = location.assign;
      var _replace = location.replace;
      
      if (typeof _assign === 'function') {
        try {
          location.assign = function(url) {
            if (shouldProxy(url)) url = toProxyUrl(url);
            return _assign.call(location, url);
          };
        } catch(ae) { /* Expected in strict browsers */ }
      }
      
      if (typeof _replace === 'function') {
        try {
          location.replace = function(url) {
            if (shouldProxy(url)) url = toProxyUrl(url);
            return _replace.call(location, url);
          };
        } catch(re) { /* Expected in strict browsers */ }
      }
    } catch(e) { /* Location override not available - SW handles fallback */ }
  })();
  
  // ═══════════════════════════════════════════════════════════
  // WINDOW.OPEN OVERRIDE
  // ═══════════════════════════════════════════════════════════
  var originalWindowOpen = window.open;
  window.open = function(url) {
    if (url && shouldProxy(url)) arguments[0] = toProxyUrl(url);
    return originalWindowOpen.apply(this, arguments);
  };
  
  // ═══════════════════════════════════════════════════════════
  // SENDBEACON OVERRIDE
  // ═══════════════════════════════════════════════════════════
  if (navigator.sendBeacon) {
    var originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      if (shouldProxy(url)) url = toProxyUrl(url);
      return originalBeacon(url, data);
    };
  }
  
  // ═══════════════════════════════════════════════════════════
  // FETCHLATER API OVERRIDE (Chrome 121+)
  // This API can leak requests outside proxy
  // ═══════════════════════════════════════════════════════════
  if (typeof window.fetchLater === 'function') {
    var originalFetchLater = window.fetchLater;
    window.fetchLater = function(input, init) {
      var url;
      if (typeof input === 'string') url = input;
      else if (input instanceof URL) url = input.href;
      else if (input instanceof Request) url = input.url;
      
      if (shouldProxy(url)) {
        var proxyUrl = toProxyUrl(url);
        if (input instanceof Request) input = new Request(proxyUrl, input);
        else input = proxyUrl;
      }
      return originalFetchLater.call(this, input, init);
    };
  }
  
  // ═══════════════════════════════════════════════════════════
  // SCHEDULER.POSTTASK OVERRIDE (for background fetch)
  // ═══════════════════════════════════════════════════════════
  if (typeof scheduler !== 'undefined' && scheduler.postTask) {
    var originalPostTask = scheduler.postTask.bind(scheduler);
    scheduler.postTask = function(callback, options) {
      // Wrap callback to intercept any fetch calls
      var wrappedCallback = function() {
        return callback.apply(this, arguments);
      };
      return originalPostTask(wrappedCallback, options);
    };
  }
  
  // ═══════════════════════════════════════════════════════════
  // HELPER: Validate if proxy URL is properly base64 encoded
  // ═══════════════════════════════════════════════════════════
  function isValidProxyUrl(url) {
    try {
      var urlObj = new URL(url);
      var path = urlObj.pathname;
      if (!path.startsWith('/p/')) return false;
      var encoded = path.substring(3);
      // Valid base64 encoded URLs are typically longer and use base64 chars
      // Invalid ones like "video-calling-apps.html" are short and have dots/extensions
      if (encoded.length < 10) return false;
      // If it has a dot but no underscore, it's probably a file extension not base64
      if (encoded.includes('.') && !encoded.includes('_') && !encoded.includes('-')) return false;
      // Try to decode to verify it's valid base64
      try {
        var base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        atob(base64); // Will throw if invalid
        return true;
      } catch(decodeErr) {
        return false;
      }
    } catch(e) {
      return false;
    }
  }
  
  // ═══════════════════════════════════════════════════════════
  // UNIVERSAL CLICK INTERCEPTION - INTERCEPT ALL EXTERNAL LINKS
  // Not just ad URLs, but ANY external URL click
  // Also fixes invalid proxy URLs (like /p/video-calling-apps.html)
  // ═══════════════════════════════════════════════════════════
  function handleExternalClick(e) {
    // Find the clicked anchor element
    var link = e.target;
    while (link && link.tagName !== 'A') {
      link = link.parentElement;
    }
    if (!link) return;
    
    var href = link.href;
    if (!href) return;
    
    // Check if it's a same-origin URL with /p/ prefix
    try {
      var urlObj = new URL(href);
      if (urlObj.origin === __realOrigin__ && href.includes('/p/')) {
        // Check if it's a VALID proxy URL (properly base64 encoded)
        if (isValidProxyUrl(href)) {
          return; // Valid proxy URL, let it pass
        }
        // Invalid proxy URL (like /p/video-calling-apps.html) - try to fix it
        var badPath = urlObj.pathname.substring(3); // Remove /p/
        if (ORIGINAL_URL_OBJ) {
          // Resolve relative URL against original URL
          try {
            var fixedUrl = new URL(badPath, ORIGINAL_URL_OBJ.href).href;
            console.log('[Proxy] Fixing invalid proxy URL:', href, '->', fixedUrl);
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            __realLocation__.href = toProxyUrl(fixedUrl);
            return false;
          } catch(resolveErr) {
            console.log('[Proxy] Could not fix invalid proxy URL:', badPath);
          }
        }
        return; // Let it pass anyway if we can't fix it
      }
    } catch(urlErr) {}
    
    // Skip non-http URLs
    if (!href.startsWith('http://') && !href.startsWith('https://')) return;
    
    // Skip same-origin URLs (that are not invalid proxy URLs)
    try {
      var urlObj2 = new URL(href);
      if (urlObj2.origin === __realOrigin__) return;
    } catch(err) {
      return;
    }
    
    // INTERCEPT THIS EXTERNAL LINK CLICK!
    console.log('[Proxy] Intercepting external link click:', href.substring(0, 60));
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    var proxyUrl = toProxyUrl(href);
    
    // Check target attribute
    var target = link.target;
    if (target === '_blank') {
      // Open in new tab but through proxy
      window.open(proxyUrl, '_blank');
    } else {
      // Navigate current window through proxy
      __realLocation__.href = proxyUrl;
    }
    
    return false;
  }
  
  document.addEventListener('click', handleExternalClick, true);
  
  // Also intercept mouseup for edge cases
  document.addEventListener('mouseup', function(e) {
    // Only left click
    if (e.button !== 0) return;
    setTimeout(function() { handleExternalClick(e); }, 10);
  }, true);
  
  // ═══════════════════════════════════════════════════════════
  // INTERCEPT DATA-HREF NAVIGATION (for JS-driven clicks)
  // Elements with data-href that use JavaScript to navigate
  // ═══════════════════════════════════════════════════════════
  function handleDataHrefClick(e) {
    var target = e.target;
    var element = target;
    
    // Find element with data-href (traverse up to 5 levels)
    var maxDepth = 5;
    while (element && maxDepth-- > 0) {
      var dataHref = element.getAttribute && element.getAttribute('data-href');
      if (dataHref) {
        // Found data-href element
        console.log('[Proxy] Intercepting data-href click:', dataHref.substring(0, 60));
        
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Check if it's already a proxy URL
        if (dataHref.startsWith('/p/')) {
          __realLocation__.href = dataHref;
        } else if (dataHref.startsWith('http://') || dataHref.startsWith('https://')) {
          // External URL - proxy it
          __realLocation__.href = toProxyUrl(dataHref);
        } else {
          // Relative URL - resolve against original URL and proxy
          if (ORIGINAL_URL_OBJ) {
            try {
              var resolved = new URL(dataHref, ORIGINAL_URL_OBJ.href).href;
              __realLocation__.href = toProxyUrl(resolved);
            } catch(resolveErr) {
              // Fallback to direct navigation
              __realLocation__.href = dataHref;
            }
          } else {
            __realLocation__.href = dataHref;
          }
        }
        return false;
      }
      element = element.parentElement;
    }
  }
  
  // Listen for clicks on elements with data-href
  document.addEventListener('click', handleDataHrefClick, true);
  
  // Also handle keyboard navigation (Enter/Space on data-href elements)
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      var target = e.target;
      var dataHref = target.getAttribute && target.getAttribute('data-href');
      if (dataHref) {
        e.preventDefault();
        handleDataHrefClick(e);
      }
    }
  }, true);
  
  console.log('[Proxy] Runtime overrides active' + (ORIGINAL_URL ? ', spoofing: ' + ORIGINAL_URL : ''));
})();
`;
}

/**
 * Process HTML content
 * @param {string} html - Original HTML
 * @param {string} pageUrl - URL of the page (for resolving relative URLs)
 * @param {Object} options - Processing options
 * @returns {string} - Processed HTML
 */
function processHtml(html, pageUrl, options = {}) {
  const $ = cheerio.load(html, {
    decodeEntities: false,
    xmlMode: false
  });
  
  // Ensure pageUrl is valid
  if (!pageUrl || !pageUrl.startsWith('http')) {
    console.warn('[htmlProcessor] Invalid pageUrl:', pageUrl);
    return $.html();
  }
  
  // Get base URL (check for <base> tag)
  let baseUrl = pageUrl;
  const baseTag = $('base[href]');
  if (baseTag.length > 0) {
    const baseHref = baseTag.attr('href');
    if (baseHref && baseHref.trim()) {
      const resolvedBase = resolveUrl(baseHref.trim(), pageUrl);
      // Only use resolved base if it's a valid absolute URL
      if (resolvedBase && resolvedBase.startsWith('http')) {
        baseUrl = resolvedBase;
      }
    }
  }
  
  // Remove or update <base> tag
  baseTag.remove();
  
  // ═══════════════════════════════════════════════════════════
  // CRITICAL: REMOVE CSP META TAGS
  // CSP meta tags block dynamic script loading (needed for Google Ads)
  // ═══════════════════════════════════════════════════════════
  $('meta[http-equiv="Content-Security-Policy"]').remove();
  $('meta[http-equiv="content-security-policy"]').remove();
  console.log('[htmlProcessor] CSP meta tags removed');
  
  // ═══════════════════════════════════════════════════════════
  // INJECT SCRIPTS AT THE START OF <head>
  // ═══════════════════════════════════════════════════════════
  let head = $('head');
  if (head.length === 0) {
    $('html').prepend('<head></head>');
    head = $('head');
  }
  
  // WebRTC blocking script (MUST BE FIRST)
  const webrtcScript = $('<script></script>');
  webrtcScript.text(getWebRtcBlockScript());
  head.prepend(webrtcScript);
  
  // Fetch/XHR override script (SECOND) - pass original page URL for spoofing
  const fetchScript = $('<script></script>');
  fetchScript.text(getFetchOverrideScript(pageUrl));
  webrtcScript.after(fetchScript);
  
  // ═══════════════════════════════════════════════════════════
  // REWRITE URL ATTRIBUTES
  // ═══════════════════════════════════════════════════════════
  for (const [tag, attrs] of Object.entries(URL_ATTRIBUTES)) {
    $(tag).each((i, elem) => {
      const $elem = $(elem);
      
      for (const attr of attrs) {
        const value = $elem.attr(attr);
        if (!value || shouldSkipUrl(value)) continue;
        
        if (attr === 'srcset') {
          // Special handling for srcset
          $elem.attr(attr, rewriteSrcset(value, baseUrl));
        } else {
          // Regular URL attribute
          const resolved = resolveUrl(value, baseUrl);
          // Pass baseUrl as fallback in case resolved is still relative
          const proxied = toProxyUrl(resolved, baseUrl);
          $elem.attr(attr, proxied);
        }
      }
      
      // Remove integrity attribute (would fail with modified content)
      if ($elem.attr('integrity')) {
        $elem.removeAttr('integrity');
      }
    });
  }
  
  // ═══════════════════════════════════════════════════════════
  // REWRITE DATA-* URL ATTRIBUTES (like data-href, data-src)
  // These are commonly used in JavaScript-driven navigation
  // ═══════════════════════════════════════════════════════════
  for (const dataAttr of DATA_URL_ATTRIBUTES) {
    $(`[${dataAttr}]`).each((i, elem) => {
      const $elem = $(elem);
      const value = $elem.attr(dataAttr);
      if (!value || shouldSkipUrl(value)) return;
      
      // Resolve and proxy the URL
      const resolved = resolveUrl(value, baseUrl);
      const proxied = toProxyUrl(resolved, baseUrl);
      $elem.attr(dataAttr, proxied);
    });
  }
  
  // ═══════════════════════════════════════════════════════════
  // REWRITE INLINE STYLES
  // ═══════════════════════════════════════════════════════════
  $('[style]').each((i, elem) => {
    const $elem = $(elem);
    const style = $elem.attr('style');
    if (style) {
      $elem.attr('style', cssProcessor.processInlineStyle(style, baseUrl));
    }
  });
  
  // ═══════════════════════════════════════════════════════════
  // REWRITE <style> TAG CONTENT
  // ═══════════════════════════════════════════════════════════
  $('style').each((i, elem) => {
    const $elem = $(elem);
    const css = $elem.html();
    if (css) {
      $elem.html(cssProcessor.processCss(css, baseUrl));
    }
  });
  
  return $.html();
}

/**
 * Get Ad iframe click interception script
 * This script intercepts ALL navigations from ad iframes and routes them through proxy
 * CRITICAL: Must intercept ALL external URLs, not filtered by ad domains
 * @returns {string}
 */
function getAdIframeInterceptScript() {
  return `
(function() {
  'use strict';
  
  // ═══════════════════════════════════════════════════════════
  // AD IFRAME NAVIGATION INTERCEPTION - ENHANCED VERSION V3
  // This runs inside ad iframes to catch ALL navigation attempts
  // Routes EVERYTHING through the proxy server
  // CRITICAL: Handles both /p/ and /external/ proxy formats
  // ═══════════════════════════════════════════════════════════
  
  // Store real location before any spoofing
  var __realLocation__ = window.location;
  var __realOrigin__ = __realLocation__.origin;
  
  function base64UrlEncode(str) {
    try {
      var base64 = btoa(unescape(encodeURIComponent(str)));
      return base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    } catch(e) { return ''; }
  }

  // Normalize URLs (handle protocol-relative //example.com)
  function normalizeUrl(url) {
    if (!url) return url;
    if (typeof url === 'string' && url.startsWith('//')) {
      return (__realLocation__.protocol || 'https:') + url;
    }
    return url;
  }
  
  // Support both /p/ and /external/ proxy formats
  function toProxyUrl(url) {
    url = normalizeUrl(url);
    // Check which format the current page uses
    if (__realLocation__.pathname.startsWith('/external/')) {
      // Use /external/ format with URL encoding
      return '/external/' + encodeURIComponent(url);
    }
    // Default to /p/ format with base64
    return '/p/' + base64UrlEncode(url);
  }
  
  function isAlreadyProxied(url) {
    if (!url) return false;
    // Check for both proxy formats
    return url.includes('/p/') || url.includes('/external/') || url.includes('/relay');
  }
  
  function isExternalUrl(url) {
    if (!url) return false;
    if (typeof url !== 'string') return false;
    url = normalizeUrl(url);
    // Already proxied - check all formats
    if (isAlreadyProxied(url)) return false;
    // Skip special URLs
    if (url.startsWith('data:')) return false;
    if (url.startsWith('blob:')) return false;
    if (url.startsWith('javascript:')) return false;
    if (url.startsWith('about:')) return false;
    if (url.startsWith('#')) return false;
    // Must have protocol
    if (!url.includes('://')) return false;
    // Check if same origin
    try {
      var urlObj = new URL(url);
      if (urlObj.origin === __realOrigin__) return false;
    } catch(e) { return false; }
    return true;
  }
  
  // ═══════════════════════════════════════════════════════════
  // CRITICAL: Override top.location setter via Proxy
  // This is the main fix for ad click redirects
  // ═══════════════════════════════════════════════════════════
  (function interceptTopLocation() {
    try {
      // Try to intercept top.location from within the iframe
      if (window.top && window.top !== window) {
        var topWindow = window.top;
        var topLocation = topWindow.location;
        
        // Create a proxy handler for location
        var locationHandler = {
          set: function(target, prop, value) {
            if (prop === 'href' && isExternalUrl(value)) {
              console.log('[Proxy:AdFrame] INTERCEPTED top.location.href:', value.substring(0, 60));
              value = toProxyUrl(value);
            }
            target[prop] = value;
            return true;
          },
          get: function(target, prop) {
            var value = target[prop];
            if (typeof value === 'function') {
              return value.bind(target);
            }
            return value;
          }
        };
        
        // Try to create proxy (may fail due to cross-origin)
        try {
          var proxyLocation = new Proxy(topLocation, locationHandler);
          // Can't actually replace top.location but we can monitor it
        } catch(proxyErr) {
          console.log('[Proxy:AdFrame] Proxy for top.location not possible:', proxyErr.message);
        }
      }
    } catch(e) {
      console.log('[Proxy:AdFrame] Could not intercept top.location:', e.message);
    }
  })();
  
  // ═══════════════════════════════════════════════════════════
  // INTERCEPT ALL CLICK EVENTS - ENHANCED CLICK BEACON SYSTEM
  // 
  // For Google Ads clicks:
  // 1. Send click to Google through proxy (registers click, hides IP)
  // 2. Get final advertiser destination
  // 3. Navigate to proxied advertiser page
  // 
  // All user data (cookies, headers) forwarded to Google
  // Only IP is hidden via proxy
  // ═══════════════════════════════════════════════════════════
  
  // Navigate top window helper (handles cross-origin)
  function navigateTopWindow(url) {
    console.log('[Proxy:AdFrame] Navigating TOP window to:', url.substring(0, 80));
    try {
      if (window.top && window.top !== window) {
        window.top.location.href = url;
      } else if (window.parent && window.parent !== window) {
        window.parent.location.href = url;
      } else {
        __realLocation__.href = url;
      }
    } catch(err) {
      console.log('[Proxy:AdFrame] Cross-origin detected, trying alternative:', err.message);
      try {
        window.parent.location.href = url;
      } catch(e2) {
        __realLocation__.href = url;
      }
    }
  }
  
  // Check if URL is a Google Ads click URL
  function isGoogleAdsClickUrl(url) {
    try {
      var hostname = new URL(url).hostname;
      return hostname.includes('googleadservices.com') ||
             hostname.includes('doubleclick.net') ||
             hostname.includes('googlesyndication.com') ||
             (hostname.includes('google') && url.includes('/aclk'));
    } catch(e) {
      return false;
    }
  }
  
  // Extract adurl parameter from Google Ads URL (fallback destination)
  function extractAdurl(googleUrl) {
    try {
      var urlObj = new URL(googleUrl);
      var adurl = urlObj.searchParams.get('adurl');
      if (adurl) {
        return decodeURIComponent(adurl);
      }
    } catch(e) {}
    return null;
  }
  
  // Decode proxied URL to get original
  function decodeProxiedUrl(proxiedUrl) {
    try {
      var urlObj = new URL(proxiedUrl);
      var encoded = urlObj.pathname.replace(/^\\/p\\//, '');
      // Handle short URLs
      if (encoded.startsWith('s/')) {
        return null; // Can't decode short URLs client-side
      }
      var base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      return decodeURIComponent(escape(atob(base64)));
    } catch(e) {
      return null;
    }
  }
  
  // Use click beacon API for Google Ads clicks
  function handleGoogleAdsClick(googleClickUrl, fallbackAdurl) {
    console.log('[Proxy:AdFrame] Processing Google Ads click via beacon...');
    console.log('[Proxy:AdFrame] Click URL:', googleClickUrl.substring(0, 80));
    
    // Gather all browser context to send with click
    var browserContext = {
      clickUrl: googleClickUrl,
      cookies: document.cookie || '',
      userAgent: navigator.userAgent,
      referrer: document.referrer || '',
      language: navigator.language || 'en-US',
      adurl: fallbackAdurl
    };
    
    // Make synchronous request to click beacon (blocking is OK for click)
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/click-beacon', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    try {
      xhr.send(JSON.stringify(browserContext));
      
      if (xhr.status === 200) {
        var response = JSON.parse(xhr.responseText);
        
        if (response.success && response.proxyUrl) {
          console.log('[Proxy:AdFrame] Click beacon success!');
          console.log('[Proxy:AdFrame] Click registered:', response.clickRegistered);
          console.log('[Proxy:AdFrame] Destination:', response.destination.substring(0, 60));
          
          // Navigate to the proxied advertiser page
          navigateTopWindow(response.proxyUrl);
          return true;
        }
      }
      
      console.warn('[Proxy:AdFrame] Click beacon returned:', xhr.status, xhr.responseText.substring(0, 100));
    } catch(err) {
      console.error('[Proxy:AdFrame] Click beacon error:', err.message);
    }
    
    // Fallback: If beacon fails but we have adurl, use it directly
    if (fallbackAdurl) {
      console.log('[Proxy:AdFrame] Using fallback adurl:', fallbackAdurl.substring(0, 60));
      navigateTopWindow(toProxyUrl(fallbackAdurl));
      return true;
    }
    
    return false;
  }
  
  function handleClick(e) {
    var target = e.target;
    
    // Find closest anchor tag - traverse up the DOM tree
    var link = null;
    var current = target;
    while (current && current !== document) {
      if (current.tagName === 'A') {
        link = current;
        break;
      }
      current = current.parentElement;
    }
    
    if (!link) return;
    
    var href = link.href;
    if (!href) return;
    
    // Skip special URLs
    if (href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('data:')) {
      return;
    }
    
    // Determine the actual target URL
    var actualUrl = href;
    var isProxied = isAlreadyProxied(href);
    
    // If it's a proxied URL, decode it to get the original
    if (isProxied) {
      var decoded = decodeProxiedUrl(href);
      if (decoded) {
        actualUrl = decoded;
      }
    }
    
    // Check if this is a Google Ads click URL
    if (isGoogleAdsClickUrl(actualUrl)) {
      console.log('[Proxy:AdFrame] Detected Google Ads click!');
      
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // Extract adurl as fallback
      var fallbackAdurl = extractAdurl(actualUrl);
      
      // Use click beacon system
      var handled = handleGoogleAdsClick(actualUrl, fallbackAdurl);
      
      if (!handled && fallbackAdurl) {
        // Last resort: navigate to adurl through proxy
        navigateTopWindow(toProxyUrl(fallbackAdurl));
      }
      
      return false;
    }
    
    // For non-Google URLs, use regular proxy navigation
    var needsTopNavigation = false;
    var finalUrl = href;
    
    if (isProxied) {
      needsTopNavigation = true;
      finalUrl = href;
      console.log('[Proxy:AdFrame] Intercepting proxied link click:', href.substring(0, 60));
    }
    else if (isExternalUrl(href)) {
      needsTopNavigation = true;
      finalUrl = toProxyUrl(href);
      console.log('[Proxy:AdFrame] Intercepting external link click:', href.substring(0, 60));
    }
    
    if (needsTopNavigation) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      navigateTopWindow(finalUrl);
      return false;
    }
  }
  
  // Attach click handler in capture phase (runs before bubble phase)
  document.addEventListener('click', handleClick, true);
  
  // Also handle touchend for mobile
  document.addEventListener('touchend', function(e) {
    // Slight delay to let click fire first
    setTimeout(function() { handleClick(e); }, 0);
  }, true);
  
  // ═══════════════════════════════════════════════════════════
  // INTERCEPT window.open (for popup ads)
  // ═══════════════════════════════════════════════════════════
  var originalOpen = window.open;
  window.open = function(url, target, features) {
    if (url && isExternalUrl(url)) {
      console.log('[Proxy:AdFrame] Intercepting window.open:', url.substring(0, 60));
      url = toProxyUrl(url);
    }
    return originalOpen.call(window, url, target, features);
  };
  
  // ═══════════════════════════════════════════════════════════
  // INTERCEPT location.href assignment
  // Google Ads often use: location.href = "https://advertiser.com"
  // ═══════════════════════════════════════════════════════════
  
  // Method 1: Try to override location.href via descriptor
  try {
    var locDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    // If location is configurable (unlikely but try)
    if (locDescriptor && locDescriptor.configurable) {
      var realLoc = window.location;
      Object.defineProperty(window, 'location', {
        get: function() {
          return new Proxy(realLoc, {
            set: function(target, prop, value) {
              if (prop === 'href' && isExternalUrl(value)) {
                value = toProxyUrl(value);
              }
              target[prop] = value;
              return true;
            }
          });
        },
        set: function(url) {
          if (isExternalUrl(url)) url = toProxyUrl(url);
          realLoc.href = url;
        }
      });
    }
  } catch(e) {}
  
  // Method 2: Override location.assign and location.replace (safer approach)
  (function() {
    try {
      var _assign = __realLocation__.assign;
      var _replace = __realLocation__.replace;
      
      if (typeof _assign === 'function') {
        __realLocation__.assign = function(url) {
          if (isExternalUrl(url)) {
            console.log('[Proxy:AdFrame] Intercepting location.assign:', url.substring(0, 60));
            url = toProxyUrl(url);
          }
          return _assign.call(__realLocation__, url);
        };
      }
      
      if (typeof _replace === 'function') {
        __realLocation__.replace = function(url) {
          if (isExternalUrl(url)) {
            console.log('[Proxy:AdFrame] Intercepting location.replace:', url.substring(0, 60));
            url = toProxyUrl(url);
          }
          return _replace.call(__realLocation__, url);
        };
      }
    } catch(e) {
      console.log('[Proxy:AdFrame] Location override not available');
    }
  })();
  
  // ═══════════════════════════════════════════════════════════
  // INTERCEPT parent.location and top.location changes
  // Ads often try: top.location.href = "https://..."
  // ═══════════════════════════════════════════════════════════
  try {
    if (window.parent && window.parent !== window) {
      var parentLoc = window.parent.location;
      if (parentLoc.assign) {
        var origParentAssign = parentLoc.assign.bind(parentLoc);
        window.parent.location.assign = function(url) {
          if (isExternalUrl(url)) url = toProxyUrl(url);
          return origParentAssign(url);
        };
      }
    }
  } catch(e) { /* Cross-origin restriction - expected */ }
  
  try {
    if (window.top && window.top !== window) {
      var topLoc = window.top.location;
      if (topLoc.assign) {
        var origTopAssign = topLoc.assign.bind(topLoc);
        window.top.location.assign = function(url) {
          if (isExternalUrl(url)) url = toProxyUrl(url);
          return origTopAssign(url);
        };
      }
    }
  } catch(e) { /* Cross-origin restriction - expected */ }
  
  // ═══════════════════════════════════════════════════════════
  // INTERCEPT form submissions - CRITICAL: Navigate TOP window
  // ═══════════════════════════════════════════════════════════
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || !form.action) return;
    
    var action = form.action;
    var needsTopNavigation = false;
    var finalUrl = action;
    
    // Check if already proxied or external
    if (isAlreadyProxied(action)) {
      needsTopNavigation = true;
      finalUrl = action;
    } else if (isExternalUrl(action)) {
      needsTopNavigation = true;
      finalUrl = toProxyUrl(action);
    }
    
    if (needsTopNavigation) {
      console.log('[Proxy:AdFrame] Intercepting form submit, navigating TOP:', finalUrl.substring(0, 60));
      e.preventDefault();
      e.stopPropagation();
      
      // Navigate TOP window instead of submitting form in iframe
      try {
        if (window.top && window.top !== window) {
          window.top.location.href = finalUrl;
        } else if (window.parent && window.parent !== window) {
          window.parent.location.href = finalUrl;
        } else {
          __realLocation__.href = finalUrl;
        }
      } catch(err) {
        form.action = finalUrl;
        form.target = '_top'; // Fallback: set target to top
      }
    }
  }, true);
  
  // ═══════════════════════════════════════════════════════════
  // INTERCEPT dynamically created anchor elements
  // Watch for new anchors added to DOM
  // ═══════════════════════════════════════════════════════════
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          // Check if it's an anchor with external href
          if (node.tagName === 'A' && node.href && isExternalUrl(node.href)) {
            // Don't rewrite the href (breaks tracking), but ensure click is intercepted
            node.addEventListener('click', handleClick, true);
          }
          // Also check child anchors
          if (node.querySelectorAll) {
            var anchors = node.querySelectorAll('a[href]');
            anchors.forEach(function(anchor) {
              if (isExternalUrl(anchor.href)) {
                anchor.addEventListener('click', handleClick, true);
              }
            });
          }
        });
      });
    });
    
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }
  
  console.log('[Proxy] Ad iframe interception active (enhanced)');
})();
`;
}

/**
 * Process Google ad iframe/content HTML
 * Now includes script injection to intercept ad clicks and navigations
 * @param {string} html - Original HTML
 * @param {string} pageUrl - URL of the content
 * @returns {string} - Processed HTML
 */
function processGoogleAdHtml(html, pageUrl) {
  const $ = cheerio.load(html, {
    decodeEntities: false,
    xmlMode: false
  });
  
  // Ensure pageUrl is valid
  if (!pageUrl || !pageUrl.startsWith('http')) {
    console.warn('[htmlProcessor] Invalid pageUrl for Google Ad HTML:', pageUrl);
    return $.html();
  }
  
  // Use page URL as base
  const baseUrl = pageUrl;
  
  // ═══════════════════════════════════════════════════════════
  // CRITICAL: REMOVE CSP META TAGS FROM AD CONTENT
  // ═══════════════════════════════════════════════════════════
  $('meta[http-equiv="Content-Security-Policy"]').remove();
  $('meta[http-equiv="content-security-policy"]').remove();
  
  // ═══════════════════════════════════════════════════════════
  // INJECT INTERCEPTION SCRIPT AT THE VERY START
  // This MUST run before any ad scripts
  // ═══════════════════════════════════════════════════════════
  let head = $('head');
  if (head.length === 0) {
    // If no head, prepend to html or body
    if ($('html').length > 0) {
      $('html').prepend('<head></head>');
      head = $('head');
    } else if ($('body').length > 0) {
      $('body').prepend('<script>' + getAdIframeInterceptScript() + '</script>');
    } else {
      // Prepend to entire document
      const script = '<script>' + getAdIframeInterceptScript() + '</script>';
      return script + $.html();
    }
  }
  
  if (head.length > 0) {
    const interceptScript = $('<script></script>');
    interceptScript.text(getAdIframeInterceptScript());
    head.prepend(interceptScript);
  }
  
  // ═══════════════════════════════════════════════════════════
  // CRITICAL FIX: DO NOT CHANGE TARGET ATTRIBUTES!
  // Previously we changed target="_top" to "_self" which caused
  // advertiser landing pages to open INSIDE the small ad iframe.
  // Now we let the click handler in getAdIframeInterceptScript()
  // intercept ALL clicks and navigate the TOP window through proxy.
  // ═══════════════════════════════════════════════════════════
  // REMOVED: target="_self" modification - was causing iframe issue
  
  // ═══════════════════════════════════════════════════════════
  // REWRITE URL ATTRIBUTES
  // ═══════════════════════════════════════════════════════════
  for (const [tag, attrs] of Object.entries(URL_ATTRIBUTES)) {
    $(tag).each((i, elem) => {
      const $elem = $(elem);
      
      for (const attr of attrs) {
        const value = $elem.attr(attr);
        if (!value || shouldSkipUrl(value)) continue;
        
        if (attr === 'srcset') {
          $elem.attr(attr, rewriteSrcset(value, baseUrl));
        } else {
          const resolved = resolveUrl(value, baseUrl);
          // Pass baseUrl as fallback in case resolved is still relative
          const proxied = toProxyUrl(resolved, baseUrl);
          $elem.attr(attr, proxied);
        }
      }
      
      // Remove integrity
      if ($elem.attr('integrity')) {
        $elem.removeAttr('integrity');
      }
    });
  }
  
  // ═══════════════════════════════════════════════════════════
  // REWRITE DATA-* URL ATTRIBUTES (like data-href, data-src)
  // ═══════════════════════════════════════════════════════════
  for (const dataAttr of DATA_URL_ATTRIBUTES) {
    $(`[${dataAttr}]`).each((i, elem) => {
      const $elem = $(elem);
      const value = $elem.attr(dataAttr);
      if (!value || shouldSkipUrl(value)) return;
      
      const resolved = resolveUrl(value, baseUrl);
      const proxied = toProxyUrl(resolved, baseUrl);
      $elem.attr(dataAttr, proxied);
    });
  }
  
  // ═══════════════════════════════════════════════════════════
  // REWRITE INLINE STYLES
  // ═══════════════════════════════════════════════════════════
  $('[style]').each((i, elem) => {
    const $elem = $(elem);
    const style = $elem.attr('style');
    if (style) {
      $elem.attr('style', cssProcessor.processInlineStyle(style, baseUrl));
    }
  });
  
  // ═══════════════════════════════════════════════════════════
  // REWRITE <style> TAG CONTENT
  // ═══════════════════════════════════════════════════════════
  $('style').each((i, elem) => {
    const $elem = $(elem);
    const css = $elem.html();
    if (css) {
      $elem.html(cssProcessor.processCss(css, baseUrl));
    }
  });
  
  return $.html();
}

module.exports = {
  processHtml,
  processGoogleAdHtml,
  resolveUrl,
  toProxyUrl,
  shouldSkipUrl,
  rewriteSrcset,
  getWebRtcBlockScript,
  getFetchOverrideScript,
  getAdIframeInterceptScript
};

