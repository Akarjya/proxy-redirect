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
  // UTILITY FUNCTIONS (MUST BE FIRST - used by location spoofing)
  // ═══════════════════════════════════════════════════════════
  
  // Store real location BEFORE any spoofing
  var __realLocation__ = window.location;
  var __realOrigin__ = __realLocation__.origin;
  
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
        location.assign = function(url) {
          if (shouldProxy(url)) url = toProxyUrl(url);
          return _assign.call(location, url);
        };
      }
      
      if (typeof _replace === 'function') {
        location.replace = function(url) {
          if (shouldProxy(url)) url = toProxyUrl(url);
          return _replace.call(location, url);
        };
      }
    } catch(e) {
      console.log('[Proxy] Location override not available - using SW fallback');
    }
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
  // INTERCEPT ALL CLICK EVENTS
  // This is the main interception for ad clicks
  // ═══════════════════════════════════════════════════════════
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
    
    // Check if this is an external URL that needs proxying
    if (isExternalUrl(href)) {
      console.log('[Proxy:AdFrame] Intercepting click to:', href.substring(0, 60));
      
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      var proxyUrl = toProxyUrl(href);
      
      // Always navigate the TOP window through proxy
      // This ensures the user stays in the proxied environment
      try {
        if (window.top && window.top !== window) {
          window.top.location.href = proxyUrl;
        } else if (window.parent && window.parent !== window) {
          window.parent.location.href = proxyUrl;
        } else {
          __realLocation__.href = proxyUrl;
        }
      } catch(err) {
        // Cross-origin restriction - use current window
        __realLocation__.href = proxyUrl;
      }
      
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
  // INTERCEPT form submissions
  // ═══════════════════════════════════════════════════════════
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form && form.action && isExternalUrl(form.action)) {
      console.log('[Proxy:AdFrame] Intercepting form submit:', form.action.substring(0, 60));
      form.action = toProxyUrl(form.action);
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
  // MODIFY TARGET ATTRIBUTES TO PREVENT TOP NAVIGATION
  // Change target="_top" and target="_blank" to target="_self" 
  // so clicks stay in the proxied context
  // ═══════════════════════════════════════════════════════════
  $('a[target="_top"], a[target="_blank"], a[target="_parent"]').each((i, elem) => {
    $(elem).attr('target', '_self');
  });
  
  $('form[target="_top"], form[target="_blank"], form[target="_parent"]').each((i, elem) => {
    $(elem).attr('target', '_self');
  });
  
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

