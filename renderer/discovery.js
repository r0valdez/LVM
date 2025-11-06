import { uuidv4, getDefaultRoomName, log } from './utils.js';

class DiscoveryController {
  constructor() {
    this.rooms = new Map(); // roomId -> data
    this.callbacks = new Set();
    this.hosting = null; // { roomId, wsPort }

    window.lan.onRoomsUpdate((rooms) => {
      const changed = this._updateRooms(rooms);
      if (changed) this._emit();
    });
  }

  _updateRooms(rooms) {
    let changed = false;
    const next = new Map();
    for (const r of rooms || []) next.set(r.roomId, r);
    if (next.size !== this.rooms.size) changed = true;
    else {
      for (const [id, v] of next.entries()) {
        const cur = this.rooms.get(id);
        if (!cur || JSON.stringify(cur) !== JSON.stringify(v)) { changed = true; break; }
      }
    }
    this.rooms = next;
    return changed;
  }

  onRooms(callback) {
    this.callbacks.add(callback);
    // immediate emit
    callback(Array.from(this.rooms.values()));
    return () => this.callbacks.delete(callback);
  }

  _emit() {
    const list = Array.from(this.rooms.values());
    for (const cb of this.callbacks) {
      try { cb(list); } catch {}
    }
  }

  async startHosting(preferredPort = 57788) {
    if (this.hosting) return this.hosting;
    const roomId = uuidv4();
    const roomName = await getDefaultRoomName();
    const res = await window.lan.hostStart(roomId, roomName, preferredPort);
    if (!res || !res.ok) throw new Error(res && res.error || 'Failed to host');
    this.hosting = { roomId, wsPort: res.wsPort, roomName };
    log('Hosting started', this.hosting);
    return this.hosting;
  }

  async stopHosting() {
    if (!this.hosting) return;
    await window.lan.hostStop();
    log('Hosting stopped');
    this.hosting = null;
  }

  getRooms() {
    return Array.from(this.rooms.values());
  }
}

export const Discovery = new DiscoveryController();


