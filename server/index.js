/**
 * Proxy POC Server - Main Entry Point
 * 
 * Express server that handles:
 * - Static file serving (loading page, SW)
 * - API routes (session management)
 * - Proxy routes (content fetching through 922proxy)
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const fs = require('fs');

const apiRoutes = require('./routes/api');
const proxyRoutes = require('./routes/proxy');
const logger = require('./utils/logger');
const proxyPool = require('./services/proxyPool');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TARGET_SITE = process.env.TARGET_SITE || 'https://testt.atolf.xyz';

// ═══════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════

// Compression
app.use(compression());

// Parse cookies
app.use(cookieParser());

// Parse JSON and URL-encoded bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`, { 
    query: Object.keys(req.query).length > 0 ? req.query : undefined 
  });
  next();
});

// ═══════════════════════════════════════════════════════════════════════
// STATIC FILES
// ═══════════════════════════════════════════════════════════════════════

const publicPath = path.join(__dirname, '..', 'public');

// Serve Service Worker with correct headers
app.get('/sw.js', (req, res) => {
  res.set({
    'Content-Type': 'application/javascript',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Service-Worker-Allowed': '/'
  });
  res.sendFile(path.join(publicPath, 'sw.js'));
});

// Serve loading page with target site injected
app.get('/', (req, res) => {
  const indexPath = path.join(publicPath, 'index.html');
  
  fs.readFile(indexPath, 'utf8', (err, html) => {
    if (err) {
      logger.error('Failed to read index.html', { error: err.message });
      return res.status(500).send('Server error');
    }
    
    // Replace placeholder with actual target site
    const modifiedHtml = html.replace('__TARGET_SITE__', TARGET_SITE);
    
    res.set('Content-Type', 'text/html');
    res.send(modifiedHtml);
  });
});

// Serve other static files
app.use('/assets', express.static(path.join(publicPath, 'assets')));

// ═══════════════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════════════

app.use('/api', apiRoutes);

// ═══════════════════════════════════════════════════════════════════════
// PROXY ROUTES (mounted at both /api and / for compatibility)
// ═══════════════════════════════════════════════════════════════════════

app.use('/api', proxyRoutes); // For Service Worker calls to /api/proxy
app.use('/', proxyRoutes);    // For direct /p/{encoded} access

// ═══════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});

// ═══════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════

app.listen(PORT, HOST, () => {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           PROXY POC SERVER STARTED                         ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  URL:         http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}                          ║`);
  console.log(`║  Target Site: ${TARGET_SITE.padEnd(43)}║`);
  console.log(`║  Proxy Host:  ${proxyPool.getProxyInfo().host.padEnd(43)}║`);
  console.log(`║  Region:      ${proxyPool.getProxyInfo().region.padEnd(43)}║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  Ready to proxy! Visit the URL above to start.             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\n');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  process.exit(0);
});

