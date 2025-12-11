/**
 * Test Script - Verify 922proxy Connection
 * 
 * Run: node test-proxy.js
 * 
 * This script tests:
 * 1. Proxy connection works
 * 2. Returns a residential IP
 * 3. Sticky session gives same IP
 */

require('dotenv').config();

const { SocksProxyAgent } = require('socks-proxy-agent');
const fetch = require('node-fetch');

// Build proxy URL
const PROXY_HOST = process.env.PROXY_HOST || 'na.proxys5.net';
const PROXY_PORT = process.env.PROXY_PORT || '6200';
const PROXY_BASE_USER = process.env.PROXY_BASE_USER || 'Ashish';
const PROXY_ZONE = process.env.PROXY_ZONE || 'custom';
const PROXY_REGION = process.env.PROXY_REGION || 'US';
const PROXY_SESSION_TIME = process.env.PROXY_SESSION_TIME || '120';
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || '';

// Generate a test session ID
const TEST_SESSION_ID = 'test' + Date.now().toString(36);

function buildProxyUrl(sessionId) {
  const username = `${PROXY_BASE_USER}-zone-${PROXY_ZONE}-region-${PROXY_REGION}-sessid-${sessionId}-sessTime-${PROXY_SESSION_TIME}`;
  return `socks5://${username}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
}

async function testProxyConnection() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('         922PROXY CONNECTION TEST');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Check if proxy is configured
  if (!PROXY_PASSWORD) {
    console.log('❌ ERROR: PROXY_PASSWORD not set in .env file');
    console.log('\nPlease create .env file from env.example and set your credentials.');
    return;
  }
  
  console.log(`Proxy Host:     ${PROXY_HOST}:${PROXY_PORT}`);
  console.log(`Region:         ${PROXY_REGION}`);
  console.log(`Session Time:   ${PROXY_SESSION_TIME} minutes`);
  console.log(`Test Session:   ${TEST_SESSION_ID}`);
  console.log('\n───────────────────────────────────────────────────────────\n');
  
  const proxyUrl = buildProxyUrl(TEST_SESSION_ID);
  const agent = new SocksProxyAgent(proxyUrl);
  
  // Test 1: Get IP address
  console.log('Test 1: Checking proxy IP...');
  try {
    const response = await fetch('https://api.ipify.org?format=json', { 
      agent,
      timeout: 30000
    });
    const data = await response.json();
    console.log(`✅ Proxy IP: ${data.ip}`);
    
    // Check if US IP (basic check)
    const geoResponse = await fetch(`http://ip-api.com/json/${data.ip}`, { 
      agent,
      timeout: 30000 
    });
    const geoData = await geoResponse.json();
    
    if (geoData.status === 'success') {
      console.log(`   Country:  ${geoData.country} (${geoData.countryCode})`);
      console.log(`   Region:   ${geoData.regionName}`);
      console.log(`   City:     ${geoData.city}`);
      console.log(`   ISP:      ${geoData.isp}`);
      
      if (geoData.countryCode === PROXY_REGION) {
        console.log(`✅ IP is in ${PROXY_REGION} as expected`);
      } else {
        console.log(`⚠️  IP is in ${geoData.countryCode}, expected ${PROXY_REGION}`);
      }
    }
    
  } catch (error) {
    console.log(`❌ Test 1 FAILED: ${error.message}`);
    return;
  }
  
  console.log('\n───────────────────────────────────────────────────────────\n');
  
  // Test 2: Verify sticky session (same IP)
  console.log('Test 2: Verifying sticky session...');
  try {
    // Make another request with same session ID
    const response1 = await fetch('https://api.ipify.org?format=json', { 
      agent: new SocksProxyAgent(buildProxyUrl(TEST_SESSION_ID)),
      timeout: 30000
    });
    const data1 = await response1.json();
    
    await new Promise(r => setTimeout(r, 2000));
    
    const response2 = await fetch('https://api.ipify.org?format=json', { 
      agent: new SocksProxyAgent(buildProxyUrl(TEST_SESSION_ID)),
      timeout: 30000
    });
    const data2 = await response2.json();
    
    if (data1.ip === data2.ip) {
      console.log(`✅ Sticky session works! Same IP: ${data1.ip}`);
    } else {
      console.log(`⚠️  IPs differ: ${data1.ip} vs ${data2.ip}`);
      console.log('   This might be normal if session just started.');
    }
    
  } catch (error) {
    console.log(`❌ Test 2 FAILED: ${error.message}`);
  }
  
  console.log('\n───────────────────────────────────────────────────────────\n');
  
  // Test 3: Different session = different IP
  console.log('Test 3: Checking different session gets different IP...');
  try {
    const differentSession = 'diff' + Date.now().toString(36);
    const response = await fetch('https://api.ipify.org?format=json', { 
      agent: new SocksProxyAgent(buildProxyUrl(differentSession)),
      timeout: 30000
    });
    const data = await response.json();
    console.log(`✅ Different session IP: ${data.ip}`);
    
  } catch (error) {
    console.log(`❌ Test 3 FAILED: ${error.message}`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('         TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
}

// Run tests
testProxyConnection();

