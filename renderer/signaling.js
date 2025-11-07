import { log } from './utils.js';
import { CryptoManager } from './crypto.js';

export class SignalingClient {
  constructor({ url, clientId, name, handlers, roomId }) {
    this.url = url;
    this.clientId = clientId;
    this.name = name;
    this.handlers = handlers || {};
    this.ws = null;
    this.crypto = roomId ? new CryptoManager(roomId) : null;
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

      ws.onmessage = async (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const t = msg.t;
        if (!t) return;
        
        // Decrypt signaling data (offers, answers, ICE candidates)
        if ((t === 'offer' || t === 'answer' || t === 'ice') && this.crypto && msg.encrypted) {
          try {
            if (msg.sdp) {
              msg.sdp = JSON.parse(await this.crypto.decrypt(msg.sdp));
            }
            if (msg.candidate) {
              msg.candidate = JSON.parse(await this.crypto.decrypt(msg.candidate));
            }
            log('[SIGNAL][renderer] Decrypted', t, 'message');
          } catch (e) {
            console.error('[SIGNAL][renderer] Decryption error:', e);
            return;
          }
        }
        
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

  async send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Encrypt signaling data (offers, answers, ICE candidates)
      if ((msg.t === 'offer' || msg.t === 'answer' || msg.t === 'ice') && this.crypto) {
        try {
          if (msg.sdp) {
            msg.sdp = await this.crypto.encrypt(JSON.stringify(msg.sdp));
            msg.encrypted = true;
          }
          if (msg.candidate) {
            msg.candidate = await this.crypto.encrypt(JSON.stringify(msg.candidate));
            msg.encrypted = true;
          }
          log('[SIGNAL][renderer] Encrypted', msg.t, 'message');
        } catch (e) {
          console.error('[SIGNAL][renderer] Encryption error:', e);
          return;
        }
      }
      log('[SIGNAL][renderer] send', msg.t);
      this.ws.send(JSON.stringify(msg));
    }
  }

  async sendOffer(to, sdp) { await this.send({ t: 'offer', from: this.clientId, to, sdp }); }
  async sendAnswer(to, sdp) { await this.send({ t: 'answer', from: this.clientId, to, sdp }); }
  async sendIce(to, candidate) { await this.send({ t: 'ice', from: this.clientId, to, candidate }); }
  async leave() { await this.send({ t: 'leave', clientId: this.clientId }); }
  close() { try { this.ws && this.ws.close(); } catch {} }
}


