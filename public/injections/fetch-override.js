/**
 * Fetch/XHR Override Script
 * 
 * This script intercepts all network requests made by JavaScript
 * and converts external URLs to proxy URLs.
 * 
 * Handles: fetch(), XMLHttpRequest, Image.src, Script.src, etc.
 * Also spoofs location/document.URL for Google Ads compatibility.
 */

(function() {
  'use strict';
  
  console.log('[Proxy] ===================================');
  console.log('[Proxy] FETCH-OVERRIDE SCRIPT LOADING...');
  console.log('[Proxy] ===================================');
  
  // ═══════════════════════════════════════════════════════════════════════
  // CRITICAL: OVERRIDE document.createElement FOR IFRAMES
  // This catches iframes created BEFORE any src is set
  // ═══════════════════════════════════════════════════════════════════════
  var originalCreateElement = document.createElement.bind(document);
  document.createElement = function(tagName) {
    var element = originalCreateElement(tagName);
    
    // If creating an iframe, immediately override its src property
    if (tagName && tagName.toLowerCase() === 'iframe') {
      console.log('[Proxy] 🎯 IFRAME ELEMENT CREATED - Installing src interceptor');
      
      // Immediately define src property before it's used
      var _internalSrc = '';
      Object.defineProperty(element, 'src', {
        get: function() {
          return _internalSrc;
        },
        set: function(value) {
          console.log('[Proxy] 🚨 IFRAME.src SET to:', value?.substring(0, 80));
          
          // Check if it's an ad URL or external URL
          if (value && typeof value === 'string') {
            var needsProxy = false;
            
            // Check if it's a Google Ad URL
            if (value.includes('googleads.g.doubleclick.net') || 
                value.includes('pagead2.googlesyndication.com') ||
                value.includes('googlesyndication.com')) {
              console.log('[Proxy] 🎯 GOOGLE AD IFRAME DETECTED!');
              needsProxy = true;
            }
            // Check if it's any external URL
            else if (value.startsWith('http://') || value.startsWith('https://')) {
              try {
                var urlObj = new URL(value);
                if (urlObj.origin !== window.location.origin) {
                  console.log('[Proxy] 🌐 EXTERNAL IFRAME DETECTED!');
                  needsProxy = true;
                }
              } catch(e) {}
            }
            
            // Proxy the URL
            if (needsProxy && !value.includes('/p/')) {
              var base64 = btoa(unescape(encodeURIComponent(value)));
              var encoded = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
              value = '/p/' + encoded;
              console.log('[Proxy] ✅ PROXIED IFRAME URL:', value.substring(0, 80));
            }
          }
          
          _internalSrc = value;
          // Set the actual attribute
          this.setAttribute('src', value);
        },
        configurable: true,
        enumerable: true
      });
    }
    
    return element;
  };
  
  console.log('[Proxy] ✅ document.createElement OVERRIDDEN for iframes');
  
  // ═══════════════════════════════════════════════════════════════════════
  // LOCATION SPOOFING FOR GOOGLE ADS
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Get original target URL from proxy path
   */
  function getOriginalUrl() {
    const path = window.location.pathname;
    if (path.startsWith('/p/')) {
      try {
        const encoded = path.substring(3);
        // Base64 URL decode
        let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        return decodeURIComponent(escape(atob(base64)));
      } catch(e) {
        return null;
      }
    }
    return null;
  }
  
  const ORIGINAL_URL = getOriginalUrl();
  let ORIGINAL_URL_OBJ = null;
  
  if (ORIGINAL_URL) {
    try {
      ORIGINAL_URL_OBJ = new URL(ORIGINAL_URL);
    } catch(e) {}
  }
  
  // Fallback: try to get original URL from referrer if current page has invalid proxy URL
  let REFERRER_ORIGINAL_URL_OBJ = null;
  if (!ORIGINAL_URL_OBJ && document.referrer) {
    try {
      const refUrl = new URL(document.referrer);
      if (refUrl.pathname.startsWith('/p/')) {
        const encoded = refUrl.pathname.substring(3);
        let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const decodedRef = decodeURIComponent(escape(atob(base64)));
        REFERRER_ORIGINAL_URL_OBJ = new URL(decodedRef);
      }
    } catch(e) {}
  }
  
  // Spoof document.URL
  if (ORIGINAL_URL) {
    try {
      Object.defineProperty(document, 'URL', {
        get: function() { return ORIGINAL_URL; },
        configurable: true
      });
    } catch(e) {}
    
    // Spoof document.documentURI
    try {
      Object.defineProperty(document, 'documentURI', {
        get: function() { return ORIGINAL_URL; },
        configurable: true
      });
    } catch(e) {}
    
    // Spoof document.baseURI
    try {
      Object.defineProperty(document, 'baseURI', {
        get: function() { return ORIGINAL_URL; },
        configurable: true
      });
    } catch(e) {}
    
    // Spoof document.domain
    if (ORIGINAL_URL_OBJ) {
      try {
        Object.defineProperty(document, 'domain', {
          get: function() { return ORIGINAL_URL_OBJ.hostname; },
          set: function() {},
          configurable: true
        });
      } catch(e) {}
    }
    
    // Spoof document.referrer
    try {
      Object.defineProperty(document, 'referrer', {
        get: function() { return ORIGINAL_URL_OBJ ? ORIGINAL_URL_OBJ.origin + '/' : ''; },
        configurable: true
      });
    } catch(e) {}
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Base64 URL encode
   */
  function base64UrlEncode(str) {
    const base64 = btoa(unescape(encodeURIComponent(str)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Normalize URL so protocol-relative values get a scheme
   */
  function normalizeUrl(url) {
    if (!url) return url;
    if (typeof url === 'string' && url.startsWith('//')) {
      return (window.location.protocol || 'https:') + url;
    }
    return url;
  }
  
  /**
   * Check if URL should be proxied
   * V2: Now handles both /p/ and /external/ proxy formats
   */
  function shouldProxy(url) {
    if (!url) return false;
    
    // Handle different input types
    if (typeof url !== 'string') {
      if (url instanceof URL) url = url.href;
      else if (url instanceof Request) url = url.url;
      else return false;
    }
    
    // Normalize protocol-relative URLs
    url = normalizeUrl(url);
    
    // Skip already proxied URLs - check ALL proxy formats
    if (url.includes('/p/')) return false;
    if (url.includes('/external/')) return false;
    if (url.includes('/relay?')) return false;
    if (url.includes('/browse')) return false;
    
    // Skip special URLs
    if (url.startsWith('data:')) return false;
    if (url.startsWith('blob:')) return false;
    if (url.startsWith('javascript:')) return false;
    if (url.startsWith('about:')) return false;
    if (url.startsWith('#')) return false;
    
    // Skip relative URLs (will be handled by SW)
    if (!url.includes('://')) return false;
    
    // Skip same-origin requests
    try {
      const urlObj = new URL(url);
      if (urlObj.origin === window.location.origin) return false;
    } catch(e) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Convert URL to proxy URL
   */
  function toProxyUrl(url) {
    url = normalizeUrl(url);
    return '/p/' + base64UrlEncode(url);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // FETCH OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════
  
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
        // Create new Request with proxy URL but same properties
        input = new Request(proxyUrl, input);
      } else {
        input = proxyUrl;
      }
    }
    
    return originalFetch.call(this, input, init);
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // XMLHttpRequest OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════
  
  const originalXHROpen = XMLHttpRequest.prototype.open;
  
  XMLHttpRequest.prototype.open = function(method, url) {
    if (shouldProxy(url)) {
      arguments[1] = toProxyUrl(url);
    }
    return originalXHROpen.apply(this, arguments);
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // ELEMENT PROPERTY OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Override element property setter
   */
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
      configurable: true,
      enumerable: descriptor.enumerable
    });
  }
  
  // Override Image.src
  try {
    overrideElementProperty(HTMLImageElement.prototype, 'src');
  } catch(e) {}
  
  // Override Script.src
  try {
    overrideElementProperty(HTMLScriptElement.prototype, 'src');
  } catch(e) {}
  
  // Override IFrame.src
  try {
    overrideElementProperty(HTMLIFrameElement.prototype, 'src');
  } catch(e) {}
  
  // Override Link.href
  try {
    overrideElementProperty(HTMLLinkElement.prototype, 'href');
  } catch(e) {}
  
  // ═══════════════════════════════════════════════════════════════════════
  // LOCATION OVERRIDES - Using safer approach that doesn't throw errors
  // Modern browsers don't allow overriding location properties
  // So we rely on Service Worker and click interception instead
  // ═══════════════════════════════════════════════════════════════════════
  
  // Try to wrap location methods (may silently fail in some browsers)
  // Note: Modern browsers restrict location property modifications
  // The Service Worker handles navigation interception as a fallback
  (function() {
    try {
      // Store original methods
      const _assign = location.assign;
      const _replace = location.replace;
      
      // Try to override (will silently fail if not allowed)
      if (typeof _assign === 'function') {
        try {
          location.assign = function(url) {
            if (shouldProxy(url)) {
              url = toProxyUrl(url);
            }
            return _assign.call(location, url);
          };
        } catch(assignErr) {
          // Expected in strict browsers - silently ignore
        }
      }
      
      if (typeof _replace === 'function') {
        try {
          location.replace = function(url) {
            if (shouldProxy(url)) {
              url = toProxyUrl(url);
            }
            return _replace.call(location, url);
          };
        } catch(replaceErr) {
          // Expected in strict browsers - silently ignore
        }
      }
    } catch(e) {
      // Silently ignore - Service Worker handles navigation interception as fallback
    }
  })();
  
  // ═══════════════════════════════════════════════════════════════════════
  // HISTORY API INTERCEPTION (for SPA-style navigations)
  // ═══════════════════════════════════════════════════════════════════════
  
  try {
    const originalPushState = history.pushState.bind(history);
    history.pushState = function(state, title, url) {
      if (url && shouldProxy(url)) {
        console.log('[Proxy] Intercepting pushState:', url);
        url = toProxyUrl(url);
      }
      return originalPushState(state, title, url);
    };
  } catch(e) {}
  
  try {
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function(state, title, url) {
      if (url && shouldProxy(url)) {
        console.log('[Proxy] Intercepting replaceState:', url);
        url = toProxyUrl(url);
      }
      return originalReplaceState(state, title, url);
    };
  } catch(e) {}
  
  // ═══════════════════════════════════════════════════════════════════════
  // WINDOW.OPEN OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════
  
  const originalWindowOpen = window.open;
  window.open = function(url) {
    if (url && shouldProxy(url)) {
      arguments[0] = toProxyUrl(url);
    }
    return originalWindowOpen.apply(this, arguments);
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // SENDBEACON OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════
  
  if (navigator.sendBeacon) {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      if (shouldProxy(url)) {
        url = toProxyUrl(url);
      }
      return originalBeacon(url, data);
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // FETCHLATER API OVERRIDE (Chrome 121+)
  // This new API can leak requests outside the proxy
  // ═══════════════════════════════════════════════════════════════════════
  
  if (typeof window.fetchLater === 'function') {
    const originalFetchLater = window.fetchLater;
    window.fetchLater = function(input, init) {
      let url;
      if (typeof input === 'string') url = input;
      else if (input instanceof URL) url = input.href;
      else if (input instanceof Request) url = input.url;
      
      if (shouldProxy(url)) {
        const proxyUrl = toProxyUrl(url);
        if (input instanceof Request) {
          input = new Request(proxyUrl, input);
        } else {
          input = proxyUrl;
        }
      }
      return originalFetchLater.call(this, input, init);
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // GOOGLE ADS URL REWRITING
  // ═══════════════════════════════════════════════════════════════════════
  
  const adDomains = [
    'googleads.g.doubleclick.net',
    'pagead2.googlesyndication.com',
    'www.googleadservices.com',
    'googleadservices.com'
  ];
  
  function isAdUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      return adDomains.some(d => hostname.includes(d));
    } catch {
      return false;
    }
  }
  
  /**
   * Rewrite Google Ad URL to use original page URL AND proxy it
   * 1. Changes the 'url' parameter from proxy URL to original target URL
   * 2. Converts the entire ad URL to a proxy URL so it loads through our server
   */
  function rewriteAdUrl(adUrl) {
    if (!isAdUrl(adUrl)) return adUrl;
    
    try {
      const urlObj = new URL(adUrl);
      
      // If we have ORIGINAL_URL, rewrite the 'url' parameter
      if (ORIGINAL_URL) {
        const urlParam = urlObj.searchParams.get('url');
        
        // If the url param contains our proxy URL, replace with original
        if (urlParam && (urlParam.includes('/p/') || urlParam.includes(window.location.origin))) {
          urlObj.searchParams.set('url', ORIGINAL_URL);
        }
      }
      
      // CRITICAL: Convert the ad URL to proxy URL so it loads through our server
      // This ensures the ad iframe content goes through our proxy
      return toProxyUrl(urlObj.toString());
    } catch(e) {}
    
    // Fallback: still proxy the ad URL even if modification fails
    return toProxyUrl(adUrl);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // IFRAME AD URL INTERCEPTION
  // ═══════════════════════════════════════════════════════════════════════
  
  // Override iframe src setter to proxy ALL external URLs including Google Ads
  try {
    const iframeDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (iframeDescriptor && iframeDescriptor.set) {
      const originalIframeSrcSetter = iframeDescriptor.set;
      
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        get: iframeDescriptor.get,
        set: function(value) {
          // CRITICAL: Proxy ALL external iframes, including Google Ads
          // Google Ad URLs get special treatment (rewrite 'url' param + proxy)
          if (value && isAdUrl(value)) {
            console.log('[Proxy] Intercepting ad iframe src:', value.substring(0, 60));
            value = rewriteAdUrl(value);
          } else if (shouldProxy(value)) {
            console.log('[Proxy] Intercepting external iframe src:', value.substring(0, 60));
            value = toProxyUrl(value);
          }
          return originalIframeSrcSetter.call(this, value);
        },
        configurable: true,
        enumerable: iframeDescriptor.enumerable
      });
    }
  } catch(e) {
    console.log('[Proxy] Could not override iframe src:', e.message);
  }
  
  // Also intercept setAttribute for iframes
  const originalSetAttribute = Element.prototype.setAttribute;
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
  
  // Watch for dynamically added iframes with MutationObserver
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.tagName === 'IFRAME' && node.src) {
          // Check if it's an ad URL or any external URL that needs proxying
          if (isAdUrl(node.src)) {
            const newSrc = rewriteAdUrl(node.src);
            if (newSrc !== node.src) {
              console.log('[Proxy] MutationObserver: Rewriting ad iframe src');
              node.src = newSrc;
            }
          } else if (shouldProxy(node.src)) {
            const newSrc = toProxyUrl(node.src);
            console.log('[Proxy] MutationObserver: Proxying external iframe src');
            node.src = newSrc;
          }
        }
      });
    });
  });
  
  // Start observing when DOM is ready
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // HTMLAnchorElement HREF OVERRIDE
  // Intercept when JavaScript dynamically sets anchor.href
  // ═══════════════════════════════════════════════════════════════════════
  
  try {
    const anchorHrefDescriptor = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href');
    if (anchorHrefDescriptor && anchorHrefDescriptor.set) {
      const originalAnchorHrefSetter = anchorHrefDescriptor.set;
      Object.defineProperty(HTMLAnchorElement.prototype, 'href', {
        get: anchorHrefDescriptor.get,
        set: function(value) {
          // Don't rewrite here, let click handler do it
          // Just pass through - rewriting href breaks ad tracking
          return originalAnchorHrefSetter.call(this, value);
        },
        configurable: true,
        enumerable: anchorHrefDescriptor.enumerable
      });
    }
  } catch(e) {
    console.log('[Proxy] Could not override anchor href:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // UNIVERSAL CLICK INTERCEPTION
  // Intercept ALL clicks on links to external URLs, not just ad URLs
  // This is CRITICAL for ad click-through to work via proxy
  // ═══════════════════════════════════════════════════════════════════════
  
  // Helper to check if a proxy URL is valid (base64 encoded)
  function isValidProxyUrl(url) {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      if (!path.startsWith('/p/')) return false;
      const encoded = path.substring(3);
      // Valid base64 encoded URLs are typically longer and use base64 chars
      // Invalid ones like "index.html" are short and have dots/extensions
      if (encoded.length < 10) return false;
      if (encoded.includes('.') && !encoded.includes('_')) return false; // Has file extension, not base64
      return true;
    } catch(e) {
      return false;
    }
  }
  
  // Intercept ALL external link clicks (not just ad URLs)
  document.addEventListener('click', function(e) {
    // Find the clicked anchor element
    let link = e.target;
    while (link && link.tagName !== 'A') {
      link = link.parentElement;
    }
    if (!link) return;
    
    const href = link.href;
    if (!href) return;
    
    // Check if it's a same-origin URL with /p/ prefix
    try {
      const urlObj = new URL(href);
      if (urlObj.origin === window.location.origin && href.includes('/p/')) {
        // Check if it's a VALID proxy URL (properly base64 encoded)
        if (isValidProxyUrl(href)) {
          return; // Valid proxy URL, let it pass
        }
        // Invalid proxy URL (like /p/index.html) - try to fix it
        const badPath = urlObj.pathname.substring(3); // Remove /p/
        const baseUrlObj = ORIGINAL_URL_OBJ || REFERRER_ORIGINAL_URL_OBJ;
        if (baseUrlObj) {
          // Resolve relative URL against original URL
          const fixedUrl = new URL(badPath, baseUrlObj.href).href;
          console.log('[Proxy] Fixing invalid proxy URL:', href, '→', fixedUrl);
          e.preventDefault();
          e.stopPropagation();
          window.location.href = toProxyUrl(fixedUrl);
          return false;
        }
      }
    } catch(err) {}
    
    // Skip non-http URLs
    if (!href.startsWith('http://') && !href.startsWith('https://')) return;
    
    // Skip same-origin URLs (that are not invalid proxy URLs)
    try {
      const urlObj = new URL(href);
      if (urlObj.origin === window.location.origin) return;
    } catch(err) {
      return;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // INTERCEPT THIS EXTERNAL LINK CLICK!
    // Route through proxy regardless of whether it's an "ad URL" or not
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log('[Proxy] Intercepting external link click:', href.substring(0, 60));
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Navigate through proxy
    const proxyUrl = toProxyUrl(href);
    
    // Check target attribute
    const target = link.target;
    if (target === '_blank') {
      // Open in new tab but through proxy
      window.open(proxyUrl, '_blank');
    } else {
      // Navigate current window through proxy
      window.location.href = proxyUrl;
    }
    
    return false;
  }, true); // Capture phase - runs before other handlers
  
  // Also intercept on mousedown for sites that use mousedown instead of click
  document.addEventListener('mousedown', function(e) {
    // Only handle left-click
    if (e.button !== 0) return;
    
    let link = e.target;
    while (link && link.tagName !== 'A') {
      link = link.parentElement;
    }
    if (!link) return;
    
    const href = link.href;
    if (!href) return;
    
    // Check for invalid proxy URLs
    try {
      const urlObj = new URL(href);
      if (urlObj.origin === window.location.origin && href.includes('/p/')) {
        if (isValidProxyUrl(href)) return;
        // Don't store data-proxy-url for invalid URLs, let click handler fix it
        return;
      }
    } catch(err) {}
    
    if (!href.startsWith('http://') && !href.startsWith('https://')) return;
    
    try {
      const urlObj = new URL(href);
      if (urlObj.origin === window.location.origin) return;
    } catch(err) {
      return;
    }
    
    // Store the proxy URL in a data attribute for the click handler
    link.setAttribute('data-proxy-url', toProxyUrl(href));
  }, true);
  
  console.log('[Proxy] Runtime overrides active');
  if (ORIGINAL_URL) {
    console.log('[Proxy] Original URL:', ORIGINAL_URL);
  }
})();

