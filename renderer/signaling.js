import { log } from './utils.js';

export class SignalingClient {
  constructor({ url, clientId, name, handlers }) {
    this.url = url;
    this.clientId = clientId;
    this.name = name;
    this.handlers = handlers || {};
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      log('[SIGNAL][renderer] connecting', this.url);

      ws.onopen = () => {
        log('[SIGNAL][renderer] open, sending join');
        ws.send(JSON.stringify({ t: 'join', clientId: this.clientId, name: this.name }));
      };

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const t = msg.t;
        if (!t) return;
        log('[SIGNAL][renderer] message', t, msg);
        if (t === 'welcome') {
          this.handlers.onWelcome && this.handlers.onWelcome(msg);
          resolve();
        } else if (t === 'peer-joined') {
          this.handlers.onPeerJoined && this.handlers.onPeerJoined(msg);
        } else if (t === 'peer-left') {
          this.handlers.onPeerLeft && this.handlers.onPeerLeft(msg);
        } else if (t === 'offer' || t === 'answer' || t === 'ice') {
          this.handlers.onSignal && this.handlers.onSignal(msg);
        } else if (t === 'end') {
          this.handlers.onEnd && this.handlers.onEnd();
        }
      };

      ws.onerror = (e) => {
        log('[SIGNAL][renderer] error', e);
      };

      ws.onclose = () => {
        log('[SIGNAL][renderer] closed');
        this.handlers.onClosed && this.handlers.onClosed();
      };
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      log('[SIGNAL][renderer] send', msg.t);
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendOffer(to, sdp) { this.send({ t: 'offer', from: this.clientId, to, sdp }); }
  sendAnswer(to, sdp) { this.send({ t: 'answer', from: this.clientId, to, sdp }); }
  sendIce(to, candidate) { this.send({ t: 'ice', from: this.clientId, to, candidate }); }
  leave() { this.send({ t: 'leave', clientId: this.clientId }); }
  close() { try { this.ws && this.ws.close(); } catch {} }
}


