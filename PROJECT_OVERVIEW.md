# Proxy Redirect Server - Project Overview

## 🎯 Purpose

This proxy server routes user traffic through 922proxy residential SOCKS5 proxies, making requests appear to originate from residential IPs. It's designed for ad verification, web scraping, and privacy-focused browsing.

---

## 🏗️ System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  User Browser   │────▶│  Proxy Server   │────▶│    922proxy     │────▶│   Target Site   │
│                 │     │   (Node.js)     │     │   (SOCKS5)      │     │                 │
│ - Service Worker│◀────│ - URL Rewriting │◀────│ - Residential IP│◀────│ - HTML/CSS/JS   │
│ - JS Overrides  │     │ - HTML Processing│    │ - Sticky Session│     │ - Resources     │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 🔑 Key Components

### 1. Service Worker (`public/sw.js`)

**What it does:** Intercepts ALL browser requests and routes them through the proxy.

**How it works:**
- Registers on page load
- Intercepts fetch events
- Converts `/p/{encoded_url}` requests to `/api/proxy?url={encoded_url}`
- Handles caching and offline scenarios

**URL Pattern:**
```
/p/aHR0cHM6Ly9leGFtcGxlLmNvbQ==  →  /api/proxy?url=aHR0cHM6Ly9leGFtcGxlLmNvbQ==
```

### 2. URL Rewriting (`server/services/htmlProcessor.js`, `cssProcessor.js`)

**Why needed:** All URLs in HTML/CSS must point to proxy paths, not original URLs.

**Base64 URL-Safe Encoding:**
```javascript
// Encode: https://example.com → aHR0cHM6Ly9leGFtcGxlLmNvbQ
function toBase64Url(url) {
  return Buffer.from(url).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Decode: aHR0cHM6Ly9leGFtcGxlLmNvbQ → https://example.com
function fromBase64Url(encoded) {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
}
```

**URLs Rewritten:**
- `<a href="...">`
- `<img src="...">`
- `<script src="...">`
- `<link href="...">`
- `<form action="...">`
- `url()` in CSS
- `@import` in CSS

### 3. WebRTC Blocking (`public/injections/webrtc-block.js`)

**Why needed:** WebRTC can leak real IP even through proxy.

**Solution:** Override RTCPeerConnection to prevent any WebRTC connections:
```javascript
window.RTCPeerConnection = function() {
  throw new Error('WebRTC disabled');
};
window.webkitRTCPeerConnection = undefined;
window.mozRTCPeerConnection = undefined;
```

### 4. JavaScript Runtime Interception (`public/injections/fetch-override.js`)

**Why needed:** JavaScript can create URLs dynamically that bypass HTML rewriting.

**APIs Overridden:**
- `fetch()` - Rewrite URL before making request
- `XMLHttpRequest` - Intercept open() to rewrite URL
- `Image.src` - Intercept src setter
- `window.open()` - Rewrite popup URLs
- `navigator.sendBeacon()` - Rewrite beacon URLs

### 5. Session Management (`server/services/sessionManager.js`)

**Features:**
- Creates unique session per user
- Maintains sticky IP with 922proxy
- Server-side cookie jar for each session
- Auto-expiration after TTL

**Session Flow:**
```
1. User visits /
2. POST /api/session creates new session
3. Session ID stored in cookie
4. All proxy requests use same session → same IP
```

### 6. 922proxy Integration (`server/services/proxyPool.js`)

**Connection Details:**
- Protocol: SOCKS5
- Host: `na.proxys5.net`
- Port: `6200`

**Username Format for Sticky Sessions:**
```
{base_user}-zone-{zone}-region-{region}-sessTime-{minutes}-sessId-{session_id}
```

Example:
```
Ashish-zone-custom-region-US-sessTime-120-sessId-abc123
```

---

## 📁 Project Structure

```
proxy-poc/
├── public/                      # Static files served to browser
│   ├── index.html              # Landing page with SW registration
│   ├── sw.js                   # Service Worker
│   ├── assets/
│   │   └── loading.css         # Loading animation styles
│   └── injections/
│       ├── webrtc-block.js     # WebRTC blocking script
│       └── fetch-override.js   # JS runtime overrides
│
├── server/
│   ├── index.js                # Express server entry point
│   ├── routes/
│   │   ├── api.js              # Session management endpoints
│   │   └── proxy.js            # Main proxy logic
│   └── services/
│       ├── contentFetcher.js   # HTTP client (axios + socks-proxy-agent)
│       ├── htmlProcessor.js    # HTML parsing & URL rewriting
│       ├── cssProcessor.js     # CSS URL rewriting
│       ├── proxyPool.js        # 922proxy connection management
│       └── sessionManager.js   # Session & cookie handling
│
├── server/utils/
│   ├── base64Url.js            # URL encoding/decoding utilities
│   ├── urlValidator.js         # SSRF prevention
│   └── logger.js               # Logging utility
│
├── env.example                 # Environment variables template
├── package.json                # Dependencies
├── test-proxy.js               # Proxy connection test script
└── README.md                   # Quick start guide
```

---

## 🔄 Request Flow

```
1. User visits http://localhost:3000
   │
2. index.html loads, registers Service Worker
   │
3. POST /api/session → Creates session, returns session ID
   │
4. Redirect to /p/{base64(TARGET_SITE)}
   │
5. Service Worker intercepts → GET /api/proxy?url={encoded}
   │
6. Server decodes URL, validates (SSRF check)
   │
7. Server fetches via 922proxy SOCKS5
   │
8. HTML/CSS processed:
   │  - All URLs rewritten to /p/{encoded}
   │  - WebRTC block script injected
   │  - Fetch override script injected
   │
9. Response sent to browser
   │
10. Browser renders page, SW intercepts all sub-requests
    │
11. Repeat steps 5-9 for each resource
```

---

## ⚙️ Configuration

### Environment Variables (.env)

```env
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Target Site
TARGET_SITE=https://example.com

# 922proxy
PROXY_HOST=na.proxys5.net
PROXY_PORT=6200
PROXY_PROTOCOL=socks5
PROXY_BASE_USER=YourUsername
PROXY_PASSWORD=YourPassword
PROXY_ZONE=custom
PROXY_REGION=US
PROXY_SESSION_TIME=120

# Session
SESSION_TTL_MINUTES=120

# Bypass proxy for testing (set to 'false' to connect directly)
USE_PROXY=true
```

---

## 🧪 Testing

### Test Proxy Connection
```bash
node test-proxy.js
```

### Test Full Flow
1. Start server: `npm start`
2. Open `http://localhost:3000`
3. Check DevTools → Application → Service Workers
4. Check Network tab for `/api/proxy` requests

---

## ⚠️ Known Issues

### TLS Handshake with 922proxy
Some HTTPS sites fail with "Client network socket disconnected before secure TLS connection was established" through 922proxy SOCKS5.

**Workaround:** Set `USE_PROXY=false` in .env to bypass proxy for testing.

---

## 🔐 Security Features

1. **SSRF Prevention** - URL validation blocks private IPs and internal hosts
2. **WebRTC Blocking** - Prevents real IP leaks
3. **Cookie Isolation** - Server-side cookie jar per session
4. **Header Sanitization** - Removes identifying headers

---

## 📚 Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js, Express.js |
| HTML Parsing | Cheerio |
| HTTP Client | Axios |
| Proxy Agent | socks-proxy-agent |
| Session | In-memory (Redis optional) |

---

## 🚀 Quick Commands

```bash
# Install dependencies
npm install

# Start server
npm start

# Start with auto-reload (development)
npm run dev

# Test proxy connection
node test-proxy.js
```

---

## 📝 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Landing page |
| POST | `/api/session` | Create new session |
| GET | `/api/session` | Get current session |
| DELETE | `/api/session` | Delete session |
| GET | `/api/status` | Server status |
| GET | `/p/{encoded_url}` | Proxy request (via Service Worker) |
| GET/POST | `/api/proxy?url={encoded}` | Backend proxy handler |

---

*Last Updated: December 2024*

