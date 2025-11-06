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
      log('[WEBRTC][renderer] ontrack from', peerId);
      let videoEl = this.peers.get(peerId)?.videoEl;
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.dataset.peer = peerId;
        this.gridEl.appendChild(videoEl);
        const rec = this.peers.get(peerId) || { pc };
        rec.videoEl = videoEl;
        this.peers.set(peerId, rec);
      }
      videoEl.srcObject = e.streams[0];
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
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(fromPeerId, sdp, onSignal) {
    log('[WEBRTC][renderer] handleOffer from', fromPeerId);
    const pc = this._ensurePeer(fromPeerId, onSignal);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(fromPeerId, sdp) {
    log('[WEBRTC][renderer] handleAnswer from', fromPeerId);
    const rec = this.peers.get(fromPeerId);
    if (!rec) return;
    await rec.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async handleIce(fromPeerId, candidate) {
    log('[WEBRTC][renderer] handleIce from', fromPeerId);
    const rec = this.peers.get(fromPeerId);
    if (!rec) return;
    try { await rec.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
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


