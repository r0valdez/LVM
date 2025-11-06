import { log } from './utils.js';

export class WebRTCManager {
  constructor({ gridEl }) {
    this.gridEl = gridEl;
    this.localStream = null;
    this.peers = new Map(); // peerId -> { pc, videoEl }
    this.selfVideo = null;
    this.clientId = null;
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

  _createPeerConnection(peerId, onSignal) {
    const pc = new RTCPeerConnection({ iceServers: [] });

    // Add local tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
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


