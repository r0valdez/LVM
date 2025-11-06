const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const WebSocket = require('ws');

const MULTICAST_ADDR = '239.255.255.250';
const MULTICAST_PORT = 55555;
const DEFAULT_WS_PORT = 57788;

let mainWindow = null;

// Discovery state (rooms seen on LAN)
const roomMap = new Map(); // roomId -> { data, lastSeen }
let discoverySocket = null;
let pruneInterval = null;

// Hosting state
let isHosting = false;
let hostInfo = null; // { roomId, roomName, hostIp, wsPort }
let announceInterval = null;
let wsServer = null;
const clientIdToSocket = new Map(); // clientId -> ws
const clientIdToInfo = new Map(); // clientId -> { name }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  console.log('[MAIN] BrowserWindow created and index.html loaded');

  mainWindow.on('closed', () => {
    console.log('[MAIN] Main window closed');
    mainWindow = null;
  });
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prefer common private ranges
        if (
          iface.address.startsWith('192.168.') ||
          iface.address.startsWith('10.') ||
          iface.address.startsWith('172.16.') ||
          iface.address.startsWith('172.17.') ||
          iface.address.startsWith('172.18.') ||
          iface.address.startsWith('172.19.') ||
          iface.address.startsWith('172.2') // covers 172.20-29
        ) {
          return iface.address;
        }
      }
    }
  }
  // Fallback to first non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function sendRoomsUpdate() {
  const rooms = Array.from(roomMap.values()).map((r) => r.data);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('rooms-update', rooms);
  }
}

function startDiscovery() {
  if (discoverySocket) return;
  discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  console.log('[DISCOVERY] UDP socket created');

  discoverySocket.on('error', (err) => {
    console.error('UDP discovery error:', err);
  });

  discoverySocket.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data && data.t === 'announce' && data.roomId) {
        console.log('[DISCOVERY] announce received', data.roomId, data.roomName, `${data.hostIp}:${data.wsPort}`, 'participants:', data.participants);
        // Ignore our own announcements
        if (isHosting && hostInfo && data.roomId === hostInfo.roomId) return;
        roomMap.set(data.roomId, { data, lastSeen: Date.now() });
        sendRoomsUpdate();
      }
    } catch (e) {
      // ignore
    }
  });

  discoverySocket.bind(MULTICAST_PORT, () => {
    try {
      discoverySocket.addMembership(MULTICAST_ADDR);
      discoverySocket.setMulticastLoopback(true);
      console.log('[DISCOVERY] Bound on', MULTICAST_PORT, 'and joined group', MULTICAST_ADDR);
    } catch (e) {
      console.error('Failed to join multicast group:', e);
    }
  });

  if (!pruneInterval) {
    pruneInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [roomId, rec] of roomMap.entries()) {
        if (now - rec.lastSeen > 6000) {
          console.log('[DISCOVERY] pruning stale room', roomId);
          roomMap.delete(roomId);
          changed = true;
        }
      }
      if (changed) sendRoomsUpdate();
    }, 1000);
  }
}

function stopDiscovery() {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
  if (discoverySocket) {
    try { discoverySocket.close(); } catch {}
    discoverySocket = null;
  }
}

function startAnnouncing(roomId, roomName, wsPort) {
  const ip = getLocalIp();
  hostInfo = { roomId, roomName, hostIp: ip, wsPort };
  if (announceInterval) clearInterval(announceInterval);
  announceInterval = setInterval(() => {
    if (!discoverySocket) return;
    const participants = 1 + clientIdToSocket.size;
    const payload = JSON.stringify({
      t: 'announce',
      roomId,
      roomName,
      hostIp: ip,
      wsPort,
      participants,
      ts: Date.now()
    });
    const buf = Buffer.from(payload);
    try {
      discoverySocket.send(buf, 0, buf.length, MULTICAST_PORT, MULTICAST_ADDR);
      // Throttle logs to avoid spam: log every tick
      console.log('[ANNOUNCE] roomId:', roomId, 'name:', roomName, 'at', `${ip}:${wsPort}`, 'participants:', participants);
    } catch (e) {
      // ignore transient send errors
    }
  }, 2000);
  console.log('[ANNOUNCE] started for room', roomId, 'on', `${ip}:${wsPort}`);
}

function stopAnnouncing() {
  if (announceInterval) {
    clearInterval(announceInterval);
    announceInterval = null;
  }
  hostInfo = null;
}

function startWsServer(port) {
  if (wsServer) return wsServer;
  wsServer = new WebSocket.Server({ port });
  console.log('[WS] Server started on port', port);

  wsServer.on('connection', (socket) => {
    console.log('[WS] New connection');
    let thisClientId = null;

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const t = msg && msg.t;
      if (!t) return;

      if (t === 'join') {
        const { clientId, name } = msg;
        if (!clientId) return;
        thisClientId = clientId;
        clientIdToSocket.set(clientId, socket);
        clientIdToInfo.set(clientId, { name: name || 'Guest' });
        console.log('[WS] join from', clientId, name);

        // Send welcome with existing participants
        const participants = Array.from(clientIdToInfo.entries())
          .filter(([id]) => id !== clientId)
          .map(([id, info]) => ({ clientId: id, name: info.name }));
        socket.send(JSON.stringify({ t: 'welcome', you: clientId, participants }));

        // Notify others
        const joinedNotice = JSON.stringify({ t: 'peer-joined', clientId, name: clientIdToInfo.get(clientId).name });
        for (const [id, ws] of clientIdToSocket.entries()) {
          if (id !== clientId) {
            try { ws.send(joinedNotice); } catch {}
          }
        }
        // Announcement will pick up new count automatically
      } else if (t === 'leave') {
        if (!thisClientId) return;
        console.log('[WS] leave from', thisClientId);
        handleClientLeave(thisClientId);
      } else if (t === 'offer' || t === 'answer' || t === 'ice') {
        const { to } = msg;
        if (!to) return;
        const target = clientIdToSocket.get(to);
        if (target) {
          try { target.send(JSON.stringify(msg)); } catch {}
          if (t === 'offer') console.log('[WS] relayed offer', 'from', msg.from, 'to', to);
          if (t === 'answer') console.log('[WS] relayed answer', 'from', msg.from, 'to', to);
          if (t === 'ice') console.log('[WS] relayed ice', 'from', msg.from, 'to', to);
        }
      }
    });

    socket.on('close', () => {
      console.log('[WS] socket closed for', thisClientId);
      if (thisClientId) handleClientLeave(thisClientId);
    });
  });

  return wsServer;
}

function handleClientLeave(clientId) {
  console.log('[WS] handling client leave', clientId);
  clientIdToSocket.delete(clientId);
  const info = clientIdToInfo.get(clientId);
  clientIdToInfo.delete(clientId);
  const notice = JSON.stringify({ t: 'peer-left', clientId, name: info ? info.name : undefined });
  for (const [id, ws] of clientIdToSocket.entries()) {
    try { ws.send(notice); } catch {}
  }
}

function stopWsServer(broadcastEnd) {
  if (!wsServer) return;
  console.log('[WS] stopping server. broadcastEnd =', !!broadcastEnd);
  if (broadcastEnd) {
    const msg = JSON.stringify({ t: 'end' });
    for (const [, ws] of clientIdToSocket.entries()) {
      try { ws.send(msg); } catch {}
    }
  }
  try { wsServer.close(); } catch {}
  wsServer = null;
  clientIdToSocket.clear();
  clientIdToInfo.clear();
}

// IPC bridge
ipcMain.handle('sys:get-hostname', () => os.hostname());
ipcMain.handle('sys:get-local-ip', () => getLocalIp());

ipcMain.handle('host:start', (e, { roomId, roomName, wsPort }) => {
  if (isHosting) return { ok: false, error: 'already-hosting' };
  try {
    console.log('[IPC] host:start', roomId, roomName, wsPort);
    startWsServer(wsPort || DEFAULT_WS_PORT);
    startAnnouncing(roomId, roomName, wsPort || DEFAULT_WS_PORT);
    isHosting = true;
    return { ok: true, hostIp: getLocalIp(), wsPort: wsPort || DEFAULT_WS_PORT };
  } catch (e2) {
    console.error('[IPC] host:start failed', e2);
    return { ok: false, error: e2 && e2.message ? e2.message : 'host-start-failed' };
  }
});

ipcMain.handle('host:stop', () => {
  console.log('[IPC] host:stop');
  if (!isHosting) return { ok: true };
  stopAnnouncing();
  stopWsServer(true);
  isHosting = false;
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  startDiscovery();
  console.log('[APP] ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  console.log('[APP] window-all-closed');
  stopAnnouncing();
  stopWsServer(false);
  stopDiscovery();
  if (process.platform !== 'darwin') app.quit();
});


