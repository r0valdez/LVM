import { log } from './utils.js';
import { CryptoManager } from './crypto.js';

export class WebRTCManager {
  constructor({ gridEl, roomId }) {
    this.gridEl = gridEl;
    this.localStream = null;
    this.peers = new Map(); // peerId -> { pc, videoEl }
    this.selfVideo = null;
    this.clientId = null;
    this.crypto = roomId ? new CryptoManager(roomId) : null;
    this.supportsInsertableStreams = this._checkInsertableStreamsSupport();
  }

  /**
   * ============================================================================
   * INSERTABLE STREAMS SUPPORT CHECK
   * ============================================================================
   * Checks if the browser supports WebRTC Insertable Streams API
   * This API allows us to intercept and encrypt/decrypt encoded frames
   */
  _checkInsertableStreamsSupport() {
    const supported = 
      typeof RTCRtpSender !== 'undefined' &&
      'transform' in RTCRtpSender.prototype &&
      typeof RTCRtpReceiver !== 'undefined' &&
      'transform' in RTCRtpReceiver.prototype;
    
    if (supported) {
      log('[WEBRTC][renderer] ✅ Insertable Streams API is supported - media encryption enabled');
    } else {
      log('[WEBRTC][renderer] ⚠️ Insertable Streams API not supported - using SRTP only (already encrypted)');
    }
    return supported;
  }

  async initLocal(clientId) {
    this.clientId = clientId;
    if (!this.localStream) {
      log('[WEBRTC][renderer] initLocal getUserMedia');
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const vid = document.createElement('video');
      vid.autoplay = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.srcObject = this.localStream;
      vid.dataset.peer = 'self';
      this.gridEl.prepend(vid);
      this.selfVideo = vid;
      log('[WEBRTC][renderer] local stream ready');
    }
  }

  /**
   * ============================================================================
   * CREATE ENCRYPTED PEER CONNECTION
   * ============================================================================
   * Creates a peer connection with media stream encryption using Insertable Streams API.
   * This encrypts video/audio frames before transmission and decrypts them on receipt.
   */
  _createPeerConnection(peerId, onSignal) {
    const pc = new RTCPeerConnection({ iceServers: [] });

    // Add local tracks with encryption
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream);
        
        // ========================================================================
        // OUTGOING STREAM ENCRYPTION (SENDER SIDE)
        // ========================================================================
        // Encrypt encoded frames before they are sent over the network
        // This happens at the encoded frame level, before SRTP encryption
        if (this.supportsInsertableStreams && this.crypto && sender && sender.transform) {
          this._setupSenderEncryption(sender, track.kind, peerId);
        }
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) onSignal({ type: 'ice', candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      log('[WEBRTC][renderer] ontrack from', peerId, 'streams:', e.streams.length, 'tracks:', e.track.kind);
      if (!e.streams || e.streams.length === 0) {
        log('[WEBRTC][renderer] ⚠️ No streams in track event');
        return;
      }
      
      // ========================================================================
      // INCOMING STREAM DECRYPTION (RECEIVER SIDE)
      // ========================================================================
      // Decrypt encoded frames after they are received from the network
      // This happens at the encoded frame level, after SRTP decryption
      if (this.supportsInsertableStreams && this.crypto && e.receiver && e.receiver.transform) {
        this._setupReceiverDecryption(e.receiver, e.track.kind, peerId);
      }
      
      let videoEl = this.peers.get(peerId)?.videoEl;
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.dataset.peer = peerId;
        videoEl.onloadedmetadata = () => {
          log('[WEBRTC][renderer] ✅ Video element loaded for', peerId);
        };
        videoEl.onerror = (err) => {
          log('[WEBRTC][renderer] ❌ Video element error for', peerId, ':', err);
        };
        this.gridEl.appendChild(videoEl);
        const rec = this.peers.get(peerId) || { pc };
        rec.videoEl = videoEl;
        this.peers.set(peerId, rec);
        log('[WEBRTC][renderer] Created video element for', peerId);
      }
      videoEl.srcObject = e.streams[0];
      log('[WEBRTC][renderer] Set video srcObject for', peerId);
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      log('[WEBRTC][renderer] connection state', peerId, st);
      if (st === 'connected') {
        log('[WEBRTC][renderer] ✅ Connected to', peerId);
      } else if (st === 'failed' || st === 'closed') {
        log('[WEBRTC][renderer] ❌ Connection failed/closed for', peerId);
        this.removePeer(peerId);
      } else if (st === 'disconnected') {
        log('[WEBRTC][renderer] ⚠️ Disconnected from', peerId, '- will retry if reconnects');
      }
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      log('[WEBRTC][renderer] ICE connection state', peerId, st);
      if (st === 'failed' || st === 'disconnected') {
        log('[WEBRTC][renderer] ICE connection issue with', peerId);
      }
    };

    pc.onicegatheringstatechange = () => {
      log('[WEBRTC][renderer] ICE gathering state', peerId, pc.iceGatheringState);
    };

    this.peers.set(peerId, { pc, videoEl: null });
    return pc;
  }

  async createOfferTo(peerId, onSignal) {
    log('[WEBRTC][renderer] createOfferTo', peerId);
    const pc = this._ensurePeer(peerId, onSignal);
    
    // Check if we're already in a state where we can't create an offer
    if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-local-offer') {
      log('[WEBRTC][renderer] Cannot create offer - signaling state is', pc.signalingState);
      // If we have a remote offer, we should answer it instead
      if (pc.signalingState === 'have-remote-offer') {
        log('[WEBRTC][renderer] Already have remote offer, will answer instead');
        return null;
      }
    }
    
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      log('[WEBRTC][renderer] Offer created and set as local description');
      return offer;
    } catch (e) {
      log('[WEBRTC][renderer] Error creating offer:', e.message);
      throw e;
    }
  }

  async handleOffer(fromPeerId, sdp, onSignal) {
    log('[WEBRTC][renderer] handleOffer from', fromPeerId);
    const pc = this._ensurePeer(fromPeerId, onSignal);
    
    // Check if we're in a valid state to receive an offer
    if (pc.signalingState !== 'stable') {
      log('[WEBRTC][renderer] Cannot handle offer - signaling state is', pc.signalingState);
      if (pc.signalingState === 'have-local-offer') {
        log('[WEBRTC][renderer] Already have local offer, ignoring incoming offer');
        return null;
      }
    }
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      log('[WEBRTC][renderer] Remote description set');
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      log('[WEBRTC][renderer] Answer created and set as local description');
      return answer;
    } catch (e) {
      log('[WEBRTC][renderer] Error handling offer:', e.message);
      throw e;
    }
  }

  async handleAnswer(fromPeerId, sdp) {
    log('[WEBRTC][renderer] handleAnswer from', fromPeerId);
    const rec = this.peers.get(fromPeerId);
    if (!rec) {
      log('[WEBRTC][renderer] No peer connection found for', fromPeerId);
      return;
    }
    
    const pc = rec.pc;
    // Check if we're in a valid state to receive an answer
    if (pc.signalingState !== 'have-local-offer') {
      log('[WEBRTC][renderer] Cannot handle answer - signaling state is', pc.signalingState);
      return;
    }
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      log('[WEBRTC][renderer] Remote answer description set');
    } catch (e) {
      log('[WEBRTC][renderer] Error handling answer:', e.message);
      throw e;
    }
  }

  async handleIce(fromPeerId, candidate) {
    log('[WEBRTC][renderer] handleIce from', fromPeerId);
    const rec = this.peers.get(fromPeerId);
    if (!rec) {
      log('[WEBRTC][renderer] No peer connection found for ICE candidate from', fromPeerId);
      return;
    }
    try {
      await rec.pc.addIceCandidate(new RTCIceCandidate(candidate));
      log('[WEBRTC][renderer] Added ICE candidate from', fromPeerId);
    } catch (e) {
      // Ignore errors for null candidates (end of ICE gathering)
      if (candidate && candidate.candidate) {
        log('[WEBRTC][renderer] Error adding ICE candidate from', fromPeerId, ':', e.message);
      }
    }
  }

  hasPeer(peerId) {
    return this.peers.has(peerId) && this.peers.get(peerId)?.pc;
  }

  _ensurePeer(peerId, onSignal) {
    const existing = this.peers.get(peerId)?.pc;
    if (existing) return existing;
    return this._createPeerConnection(peerId, ({ type, candidate }) => {
      if (type === 'ice') onSignal && onSignal(candidate);
    });
  }

  /**
   * ============================================================================
   * SETUP SENDER ENCRYPTION (OUTGOING STREAMS)
   * ============================================================================
   * Creates an encoded transform that encrypts video/audio frames before transmission.
   * The encrypted frames are then sent over WebRTC (which also applies SRTP encryption).
   * This provides double encryption: our AES-256-GCM + WebRTC's SRTP.
   */
  _setupSenderEncryption(sender, trackKind, peerId) {
    if (!this.crypto) return;

    try {
      const transformer = new TransformStream({
        transform: async (encodedFrame, controller) => {
          try {
            // Get the encoded frame data
            const data = new Uint8Array(encodedFrame.data);
            
            // Encrypt the frame data using AES-256-GCM
            const encryptedData = await this.crypto.encryptBinary(data);
            
            // Create a new encoded frame with encrypted data
            // Note: We need to preserve the frame structure
            const encryptedFrame = Object.create(Object.getPrototypeOf(encodedFrame));
            Object.assign(encryptedFrame, encodedFrame);
            encryptedFrame.data = encryptedData.buffer;
            
            controller.enqueue(encryptedFrame);
            
            log(`[WEBRTC][renderer] 🔒 Encrypted ${trackKind} frame for ${peerId} (${data.length} → ${encryptedData.length} bytes)`);
          } catch (e) {
            console.error(`[WEBRTC][renderer] Encryption error for ${trackKind} frame:`, e);
            // On error, pass through original frame (fallback)
            controller.enqueue(encodedFrame);
          }
        }
      });

      // Apply the transform to the sender
      sender.transform = transformer;
      log(`[WEBRTC][renderer] ✅ Sender encryption enabled for ${trackKind} track to ${peerId}`);
    } catch (e) {
      console.error(`[WEBRTC][renderer] Failed to setup sender encryption:`, e);
    }
  }

  /**
   * ============================================================================
   * SETUP RECEIVER DECRYPTION (INCOMING STREAMS)
   * ============================================================================
   * Creates an encoded transform that decrypts video/audio frames after reception.
   * The frames are received from WebRTC (after SRTP decryption), then we decrypt
   * our AES-256-GCM layer, and finally decode/display the frames.
   */
  _setupReceiverDecryption(receiver, trackKind, peerId) {
    if (!this.crypto) return;

    try {
      const transformer = new TransformStream({
        transform: async (encodedFrame, controller) => {
          try {
            // Get the encrypted frame data
            const encryptedData = new Uint8Array(encodedFrame.data);
            
            // Decrypt the frame data using AES-256-GCM
            const decryptedData = await this.crypto.decryptBinary(encryptedData);
            
            // Create a new encoded frame with decrypted data
            // Note: We need to preserve the frame structure
            const decryptedFrame = Object.create(Object.getPrototypeOf(encodedFrame));
            Object.assign(decryptedFrame, encodedFrame);
            decryptedFrame.data = decryptedData.buffer;
            
            controller.enqueue(decryptedFrame);
            
            log(`[WEBRTC][renderer] 🔓 Decrypted ${trackKind} frame from ${peerId} (${encryptedData.length} → ${decryptedData.length} bytes)`);
          } catch (e) {
            console.error(`[WEBRTC][renderer] Decryption error for ${trackKind} frame:`, e);
            // On error, pass through original frame (fallback)
            controller.enqueue(encodedFrame);
          }
        }
      });

      // Apply the transform to the receiver
      receiver.transform = transformer;
      log(`[WEBRTC][renderer] ✅ Receiver decryption enabled for ${trackKind} track from ${peerId}`);
    } catch (e) {
      console.error(`[WEBRTC][renderer] Failed to setup receiver decryption:`, e);
    }
  }

  removePeer(peerId) {
    log('[WEBRTC][renderer] removePeer', peerId);
    const rec = this.peers.get(peerId);
    if (!rec) return;
    try { rec.pc.close(); } catch {}
    if (rec.videoEl && rec.videoEl.parentNode) rec.videoEl.parentNode.removeChild(rec.videoEl);
    this.peers.delete(peerId);
  }

  cleanup() {
    log('[WEBRTC][renderer] cleanup');
    for (const [peerId] of this.peers) this.removePeer(peerId);
    if (this.selfVideo && this.selfVideo.parentNode) this.selfVideo.parentNode.removeChild(this.selfVideo);
    this.selfVideo = null;
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
  }
}


