# Proxy Redirect Server

A proxy server that routes traffic through 922proxy SOCKS5 residential proxies with full URL rewriting, Service Worker interception, and WebRTC blocking.

## Features

- **Service Worker Interception** - All browser requests are intercepted and routed through the proxy
- **URL Rewriting** - HTML, CSS, and JavaScript URLs are rewritten to use proxy paths
- **WebRTC Blocking** - Prevents IP leaks by overriding RTCPeerConnection APIs
- **JavaScript Runtime Interception** - Overrides fetch, XMLHttpRequest, and other APIs
- **Session Management** - Sticky sessions with 922proxy for consistent IP usage
- **Cookie Handling** - Server-side cookie jar for proper ad network interaction

## Architecture

```
User Browser → Service Worker → Proxy Server → 922proxy (SOCKS5) → Target Site
```

## Quick Start

### 1. Install Dependencies

```bash
cd proxy-poc
npm install
```

### 2. Configure Environment

```bash
cp env.example .env
# Edit .env with your 922proxy credentials
```

### 3. Start Server

```bash
npm start
# or for development
npm run dev
```

### 4. Access

Navigate to `http://localhost:3000` to start a proxied session.

## Configuration

Key environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `TARGET_SITE` | Site to proxy | - |
| `PROXY_HOST` | 922proxy SOCKS5 host | na.proxys5.net |
| `PROXY_PORT` | 922proxy port | 6200 |
| `PROXY_BASE_USER` | 922proxy username | - |
| `PROXY_PASSWORD` | 922proxy password | - |
| `USE_PROXY` | Enable/disable proxy | true |
| `SESSION_TTL_MINUTES` | Session duration | 120 |

## Testing

### Test Proxy Connection

```bash
node test-proxy.js
```

### Test Full Flow

1. Start the server
2. Open `http://localhost:3000`
3. Check browser DevTools for Service Worker registration
4. Verify requests are routed through `/api/proxy`

## Known Issues

- **TLS with 922proxy**: Some HTTPS sites may have TLS handshake issues through 922proxy SOCKS5. Set `USE_PROXY=false` to bypass for testing.

## Project Structure

```
proxy-poc/
├── public/
│   ├── index.html      # Landing page with SW registration
│   └── sw.js           # Service Worker
├── server/
│   ├── index.js        # Express server entry
│   ├── routes/
│   │   ├── api.js      # Session management API
│   │   └── proxy.js    # Proxy routing logic
│   └── services/
│       ├── contentFetcher.js   # HTTP client
│       ├── cssProcessor.js     # CSS URL rewriting
│       ├── htmlProcessor.js    # HTML processing
│       ├── proxyPool.js        # 922proxy integration
│       └── sessionManager.js   # Session handling
├── utils/
│   ├── base64Url.js    # URL encoding utilities
│   ├── logger.js       # Logging utility
│   └── urlValidator.js # SSRF prevention
├── env.example         # Environment template
├── package.json
└── test-proxy.js       # Proxy connection test
```

## Technology Stack

- **Backend**: Node.js, Express.js
- **HTML Parsing**: Cheerio
- **Proxy**: socks-proxy-agent, axios
- **Session**: In-memory (Redis optional)

## License

MIT

