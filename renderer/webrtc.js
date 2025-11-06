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
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const vid = document.createElement('video');
      vid.autoplay = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.srcObject = this.localStream;
      vid.dataset.peer = 'self';
      this.gridEl.prepend(vid);
      this.selfVideo = vid;
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
      if (st === 'failed' || st === 'closed' || st === 'disconnected') {
        this.removePeer(peerId);
      }
    };

    this.peers.set(peerId, { pc, videoEl: null });
    return pc;
  }

  async createOfferTo(peerId, onSignal) {
    const pc = this._ensurePeer(peerId, onSignal);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(fromPeerId, sdp, onSignal) {
    const pc = this._ensurePeer(fromPeerId, onSignal);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(fromPeerId, sdp) {
    const rec = this.peers.get(fromPeerId);
    if (!rec) return;
    await rec.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async handleIce(fromPeerId, candidate) {
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
    const rec = this.peers.get(peerId);
    if (!rec) return;
    try { rec.pc.close(); } catch {}
    if (rec.videoEl && rec.videoEl.parentNode) rec.videoEl.parentNode.removeChild(rec.videoEl);
    this.peers.delete(peerId);
  }

  cleanup() {
    for (const [peerId] of this.peers) this.removePeer(peerId);
    if (this.selfVideo && this.selfVideo.parentNode) this.selfVideo.parentNode.removeChild(this.selfVideo);
    this.selfVideo = null;
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
  }
}


