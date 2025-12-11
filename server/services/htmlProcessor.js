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
  
  try {
    // Handle protocol-relative URLs
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    
    // If already absolute, return as-is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // Resolve relative URL
    return new URL(url, baseUrl).href;
  } catch (e) {
    return url;
  }
}

/**
 * Convert URL to proxy URL
 * @param {string} absoluteUrl - Absolute URL
 * @returns {string}
 */
function toProxyUrl(absoluteUrl) {
  if (!absoluteUrl || shouldSkipUrl(absoluteUrl)) {
    return absoluteUrl;
  }
  
  // Only proxy http/https URLs
  if (!absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
    return absoluteUrl;
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
      const proxied = toProxyUrl(resolved);
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
 * @returns {string}
 */
function getFetchOverrideScript() {
  return `
(function() {
  'use strict';
  
  // Base64 URL encode function
  function base64UrlEncode(str) {
    const base64 = btoa(unescape(encodeURIComponent(str)));
    return base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }
  
  // Check if URL should be proxied
  function shouldProxy(url) {
    if (!url) return false;
    if (typeof url !== 'string') {
      if (url instanceof URL) url = url.href;
      else if (url instanceof Request) url = url.url;
      else return false;
    }
    
    // Skip already proxied URLs
    if (url.includes('/p/')) return false;
    
    // Skip data/blob URLs
    if (url.startsWith('data:')) return false;
    if (url.startsWith('blob:')) return false;
    if (url.startsWith('javascript:')) return false;
    
    // Skip relative URLs (handled by SW)
    if (!url.includes('://')) return false;
    
    // Skip same-origin requests (they go through SW anyway)
    try {
      const urlObj = new URL(url);
      if (urlObj.origin === window.location.origin) return false;
    } catch(e) {}
    
    return true;
  }
  
  // Convert URL to proxy URL
  function toProxyUrl(url) {
    return '/p/' + base64UrlEncode(url);
  }
  
  // ═══════════════════════════════════════════════════════════
  // FETCH OVERRIDE
  // ═══════════════════════════════════════════════════════════
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    let url;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input instanceof Request) {
      url = input.url;
    }
    
    if (shouldProxy(url)) {
      const proxyUrl = toProxyUrl(url);
      if (input instanceof Request) {
        input = new Request(proxyUrl, input);
      } else {
        input = proxyUrl;
      }
    }
    
    return originalFetch.call(this, input, init);
  };
  
  // ═══════════════════════════════════════════════════════════
  // XMLHttpRequest OVERRIDE
  // ═══════════════════════════════════════════════════════════
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (shouldProxy(url)) {
      arguments[1] = toProxyUrl(url);
    }
    return originalXHROpen.apply(this, arguments);
  };
  
  // ═══════════════════════════════════════════════════════════
  // Element SRC/HREF property overrides
  // ═══════════════════════════════════════════════════════════
  function overrideElementProperty(prototype, property) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (!descriptor || !descriptor.set) return;
    
    const originalSetter = descriptor.set;
    
    Object.defineProperty(prototype, property, {
      get: descriptor.get,
      set: function(value) {
        if (shouldProxy(value)) {
          value = toProxyUrl(value);
        }
        return originalSetter.call(this, value);
      },
      configurable: true
    });
  }
  
  // Override Image src
  try {
    overrideElementProperty(HTMLImageElement.prototype, 'src');
  } catch(e) {}
  
  // Override Script src
  try {
    overrideElementProperty(HTMLScriptElement.prototype, 'src');
  } catch(e) {}
  
  // Override IFrame src
  try {
    overrideElementProperty(HTMLIFrameElement.prototype, 'src');
  } catch(e) {}
  
  // ═══════════════════════════════════════════════════════════
  // LOCATION OVERRIDE
  // ═══════════════════════════════════════════════════════════
  const originalAssign = location.assign.bind(location);
  location.assign = function(url) {
    if (shouldProxy(url)) {
      url = toProxyUrl(url);
    }
    return originalAssign(url);
  };
  
  const originalReplace = location.replace.bind(location);
  location.replace = function(url) {
    if (shouldProxy(url)) {
      url = toProxyUrl(url);
    }
    return originalReplace(url);
  };
  
  // ═══════════════════════════════════════════════════════════
  // WINDOW.OPEN OVERRIDE
  // ═══════════════════════════════════════════════════════════
  const originalWindowOpen = window.open;
  window.open = function(url) {
    if (url && shouldProxy(url)) {
      arguments[0] = toProxyUrl(url);
    }
    return originalWindowOpen.apply(this, arguments);
  };
  
  // ═══════════════════════════════════════════════════════════
  // SENDBEACON OVERRIDE
  // ═══════════════════════════════════════════════════════════
  if (navigator.sendBeacon) {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      if (shouldProxy(url)) {
        url = toProxyUrl(url);
      }
      return originalBeacon(url, data);
    };
  }
  
  // ═══════════════════════════════════════════════════════════
  // CLICK INTERCEPTION FOR AD URLS
  // ═══════════════════════════════════════════════════════════
  const adClickDomains = [
    'googleadservices.com',
    'googleads.g.doubleclick.net',
    'pagead2.googlesyndication.com',
    'www.googleadservices.com'
  ];
  
  function isAdClickUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      return adClickDomains.some(d => hostname.includes(d));
    } catch {
      return false;
    }
  }
  
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a');
    if (!link) return;
    
    const href = link.href;
    if (!href) return;
    
    // Already proxied
    if (href.includes('/p/')) return;
    
    // Check if ad click URL
    if (isAdClickUrl(href)) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = toProxyUrl(href);
    }
  }, true);
  
  console.log('[Proxy] Runtime overrides active');
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
  
  // Get base URL (check for <base> tag)
  let baseUrl = pageUrl;
  const baseTag = $('base[href]');
  if (baseTag.length > 0) {
    const baseHref = baseTag.attr('href');
    if (baseHref) {
      baseUrl = resolveUrl(baseHref, pageUrl);
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
  
  // Fetch/XHR override script (SECOND)
  const fetchScript = $('<script></script>');
  fetchScript.text(getFetchOverrideScript());
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
          const proxied = toProxyUrl(resolved);
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
 * Process Google ad iframe/content HTML (same rewriting, no script injection)
 * @param {string} html - Original HTML
 * @param {string} pageUrl - URL of the content
 * @returns {string} - Processed HTML
 */
function processGoogleAdHtml(html, pageUrl) {
  const $ = cheerio.load(html, {
    decodeEntities: false,
    xmlMode: false
  });
  
  // Use page URL as base
  const baseUrl = pageUrl;
  
  // Rewrite URL attributes (same as main page)
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
          const proxied = toProxyUrl(resolved);
          $elem.attr(attr, proxied);
        }
      }
      
      // Remove integrity
      if ($elem.attr('integrity')) {
        $elem.removeAttr('integrity');
      }
    });
  }
  
  // Rewrite inline styles
  $('[style]').each((i, elem) => {
    const $elem = $(elem);
    const style = $elem.attr('style');
    if (style) {
      $elem.attr('style', cssProcessor.processInlineStyle(style, baseUrl));
    }
  });
  
  // Rewrite <style> content
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
  getFetchOverrideScript
};

