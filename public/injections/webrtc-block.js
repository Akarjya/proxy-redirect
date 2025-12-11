/**
 * WebRTC Blocking Script
 * 
 * This script is injected into proxied HTML pages to prevent WebRTC IP leaks.
 * It replaces RTCPeerConnection and related APIs with fake implementations.
 * 
 * MUST be injected at the START of <head> before any other scripts.
 */

(function() {
  'use strict';
  
  // ═══════════════════════════════════════════════════════════════════════
  // FAKE RTCPeerConnection
  // ═══════════════════════════════════════════════════════════════════════
  
  function FakeRTCPeerConnection(config) {
    // Properties
    this.localDescription = null;
    this.remoteDescription = null;
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
    this.iceGatheringState = 'complete';
    this.signalingState = 'closed';
    
    // Event handlers (will never be called)
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
  FakeRTCPeerConnection.prototype.createOffer = function() {
    return Promise.resolve(null);
  };
  
  FakeRTCPeerConnection.prototype.createAnswer = function() {
    return Promise.resolve(null);
  };
  
  FakeRTCPeerConnection.prototype.setLocalDescription = function() {
    return Promise.resolve();
  };
  
  FakeRTCPeerConnection.prototype.setRemoteDescription = function() {
    return Promise.resolve();
  };
  
  FakeRTCPeerConnection.prototype.addIceCandidate = function() {
    return Promise.resolve();
  };
  
  FakeRTCPeerConnection.prototype.createDataChannel = function() {
    return {
      close: function() {},
      send: function() {}
    };
  };
  
  FakeRTCPeerConnection.prototype.addTrack = function() {
    return null;
  };
  
  FakeRTCPeerConnection.prototype.removeTrack = function() {};
  
  FakeRTCPeerConnection.prototype.close = function() {};
  
  FakeRTCPeerConnection.prototype.getStats = function() {
    return Promise.resolve(new Map());
  };
  
  FakeRTCPeerConnection.prototype.getSenders = function() {
    return [];
  };
  
  FakeRTCPeerConnection.prototype.getReceivers = function() {
    return [];
  };
  
  FakeRTCPeerConnection.prototype.getTransceivers = function() {
    return [];
  };
  
  FakeRTCPeerConnection.prototype.addTransceiver = function() {
    return null;
  };
  
  FakeRTCPeerConnection.generateCertificate = function() {
    return Promise.resolve({});
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // OVERRIDE WINDOW PROPERTIES
  // ═══════════════════════════════════════════════════════════════════════
  
  try {
    Object.defineProperty(window, 'RTCPeerConnection', {
      value: FakeRTCPeerConnection,
      writable: false,
      configurable: false
    });
  } catch(e) {
    window.RTCPeerConnection = FakeRTCPeerConnection;
  }
  
  try {
    Object.defineProperty(window, 'webkitRTCPeerConnection', {
      value: FakeRTCPeerConnection,
      writable: false,
      configurable: false
    });
  } catch(e) {
    window.webkitRTCPeerConnection = FakeRTCPeerConnection;
  }
  
  try {
    Object.defineProperty(window, 'mozRTCPeerConnection', {
      value: FakeRTCPeerConnection,
      writable: false,
      configurable: false
    });
  } catch(e) {
    window.mozRTCPeerConnection = FakeRTCPeerConnection;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // FAKE RTCSessionDescription and RTCIceCandidate
  // ═══════════════════════════════════════════════════════════════════════
  
  function FakeRTCSessionDescription(init) {
    this.type = init?.type || '';
    this.sdp = init?.sdp || '';
  }
  
  function FakeRTCIceCandidate(init) {
    this.candidate = init?.candidate || '';
    this.sdpMid = init?.sdpMid || null;
    this.sdpMLineIndex = init?.sdpMLineIndex || null;
  }
  
  try {
    Object.defineProperty(window, 'RTCSessionDescription', {
      value: FakeRTCSessionDescription,
      writable: false,
      configurable: false
    });
  } catch(e) {}
  
  try {
    Object.defineProperty(window, 'RTCIceCandidate', {
      value: FakeRTCIceCandidate,
      writable: false,
      configurable: false
    });
  } catch(e) {}
  
  // ═══════════════════════════════════════════════════════════════════════
  // OVERRIDE getUserMedia
  // ═══════════════════════════════════════════════════════════════════════
  
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = function() {
      return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    };
    
    navigator.mediaDevices.enumerateDevices = function() {
      return Promise.resolve([]);
    };
    
    navigator.mediaDevices.getDisplayMedia = function() {
      return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    };
  }
  
  // Legacy getUserMedia
  if (navigator.getUserMedia) {
    navigator.getUserMedia = function(constraints, success, error) {
      error(new DOMException('Permission denied', 'NotAllowedError'));
    };
  }
  
  if (navigator.webkitGetUserMedia) {
    navigator.webkitGetUserMedia = function(constraints, success, error) {
      error(new DOMException('Permission denied', 'NotAllowedError'));
    };
  }
  
  if (navigator.mozGetUserMedia) {
    navigator.mozGetUserMedia = function(constraints, success, error) {
      error(new DOMException('Permission denied', 'NotAllowedError'));
    };
  }
  
  console.log('[Proxy] WebRTC blocked');
})();

