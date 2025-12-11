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
   * Check if URL should be proxied
   */
  function shouldProxy(url) {
    if (!url) return false;
    
    // Handle different input types
    if (typeof url !== 'string') {
      if (url instanceof URL) url = url.href;
      else if (url instanceof Request) url = url.url;
      else return false;
    }
    
    // Skip already proxied URLs
    if (url.includes('/p/')) return false;
    
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
  // LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════
  
  try {
    const originalAssign = location.assign.bind(location);
    Object.defineProperty(location, 'assign', {
      value: function(url) {
        if (shouldProxy(url)) {
          url = toProxyUrl(url);
        }
        return originalAssign(url);
      },
      writable: false,
      configurable: false
    });
  } catch(e) {}
  
  try {
    const originalReplace = location.replace.bind(location);
    Object.defineProperty(location, 'replace', {
      value: function(url) {
        if (shouldProxy(url)) {
          url = toProxyUrl(url);
        }
        return originalReplace(url);
      },
      writable: false,
      configurable: false
    });
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
   * Rewrite Google Ad URL to use original page URL
   * Changes the 'url' parameter from proxy URL to original target URL
   */
  function rewriteAdUrl(adUrl) {
    if (!ORIGINAL_URL || !isAdUrl(adUrl)) return adUrl;
    
    try {
      const urlObj = new URL(adUrl);
      const urlParam = urlObj.searchParams.get('url');
      
      // If the url param contains our proxy URL, replace with original
      if (urlParam && urlParam.includes('/p/')) {
        urlObj.searchParams.set('url', ORIGINAL_URL);
        return urlObj.toString();
      }
      
      // If url param is our proxy origin, replace with original
      if (urlParam && urlParam.includes(window.location.origin)) {
        urlObj.searchParams.set('url', ORIGINAL_URL);
        return urlObj.toString();
      }
    } catch(e) {}
    
    return adUrl;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // IFRAME AD URL INTERCEPTION
  // ═══════════════════════════════════════════════════════════════════════
  
  // Override iframe src setter to rewrite Google Ad URLs
  try {
    const iframeDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (iframeDescriptor && iframeDescriptor.set) {
      const originalIframeSrcSetter = iframeDescriptor.set;
      
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        get: iframeDescriptor.get,
        set: function(value) {
          // Rewrite Google Ad URLs to use original page URL
          if (value && isAdUrl(value)) {
            value = rewriteAdUrl(value);
          } else if (shouldProxy(value)) {
            value = toProxyUrl(value);
          }
          return originalIframeSrcSetter.call(this, value);
        },
        configurable: true,
        enumerable: iframeDescriptor.enumerable
      });
    }
  } catch(e) {}
  
  // Also intercept setAttribute for iframes
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (this.tagName === 'IFRAME' && name.toLowerCase() === 'src') {
      if (value && isAdUrl(value)) {
        value = rewriteAdUrl(value);
      } else if (shouldProxy(value)) {
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
          if (isAdUrl(node.src)) {
            const newSrc = rewriteAdUrl(node.src);
            if (newSrc !== node.src) {
              node.src = newSrc;
            }
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
  // AD CLICK INTERCEPTION
  // ═══════════════════════════════════════════════════════════════════════
  
  // Intercept clicks on ad links
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a');
    if (!link) return;
    
    const href = link.href;
    if (!href) return;
    
    // Already proxied
    if (href.includes('/p/')) return;
    
    // Check if ad click URL
    if (isAdUrl(href)) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = toProxyUrl(href);
    }
  }, true); // Capture phase
  
  console.log('[Proxy] Runtime overrides active');
  if (ORIGINAL_URL) {
    console.log('[Proxy] Original URL:', ORIGINAL_URL);
  }
})();

