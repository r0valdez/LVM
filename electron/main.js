const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const WebSocket = require('ws');

const MULTICAST_ADDR = '239.255.255.250';
const MULTICAST_PORT = 55555;
const DEFAULT_WS_PORT = 57788;

let mainWindow = null;
let tray = null;
let isInMeeting = false; // Track if user is in a meeting

// Discovery state (rooms seen on LAN)
// All peers (hosts and participants) share the same UDP multicast listener
// Discovery socket is created immediately at app startup (before any room creation)
const roomMap = new Map(); // roomId -> { data, lastSeen }
let discoverySocket = null; // Shared UDP socket for all peers
let pruneInterval = null;

// Hosting state
let isHosting = false;
let hostInfo = null; // { roomId, roomName, hostIp, wsPort }
let announceInterval = null;
let wsServer = null;
const clientIdToSocket = new Map(); // clientId -> ws
const clientIdToInfo = new Map(); // clientId -> { name }

function createTray() {
  // Try to load icon from assets folder
  let icon;
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('Icon is empty');
    console.log('[MAIN] Loaded tray icon from', iconPath);
  } catch (e) {
    // Fallback: create a simple 16x16 icon using a data URL (1x1 blue pixel scaled)
    // This creates a minimal blue square icon
    const iconData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    try {
      icon = nativeImage.createFromBuffer(iconData);
      // Resize to 16x16 for tray
      icon = icon.resize({ width: 16, height: 16 });
      console.log('[MAIN] Created default tray icon');
    } catch (e2) {
      // Last resort: use empty icon (Windows will show default)
      console.log('[MAIN] Using system default tray icon');
      icon = nativeImage.createEmpty();
    }
  }
  
  tray = new Tray(icon);
  updateTrayIcon();
  
  tray.setToolTip('LAN Video Meeting');
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });
  
  console.log('[MAIN] Tray icon created');
}

function updateTrayIcon() {
  if (!tray) return;
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isInMeeting ? 'In Meeting' : 'Not in Meeting',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  
  mainWindow = new BrowserWindow({
    width: 900,
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

  mainWindow.on('close', (event) => {
    if (isInMeeting) {
      // Prevent closing if in a meeting
      console.log('[MAIN] Window close prevented - user is in a meeting');
      event.preventDefault();
      mainWindow.hide();
    } else {
      // Allow closing but hide to tray instead of destroying
      console.log('[MAIN] Window closing - hiding to tray');
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    console.log('[MAIN] Main window closed');
    // Don't set mainWindow to null - we want to keep it for tray
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

// Start UDP multicast discovery listener
// Called immediately at app startup - all peers (hosts and participants) use this same socket
function startDiscovery() {
  if (discoverySocket) return;
  discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  console.log('[DISCOVERY] UDP socket created (shared by all peers)');

  discoverySocket.on('error', (err) => {
    console.error('[DISCOVERY] Socket error:', err);
  });

  discoverySocket.on('message', (msg, rinfo) => {
    console.log('[DISCOVERY] RAW UDP packet received from', rinfo.address + ':' + rinfo.port, 'size:', msg.length, 'bytes');
    try {
      const data = JSON.parse(msg.toString());
      console.log('[DISCOVERY] Parsed message type:', data.t);
      if (data && data.t === 'announce' && data.roomId) {
        console.log('[DISCOVERY] announce received from', rinfo.address + ':' + rinfo.port, '- roomId:', data.roomId, 'name:', data.roomName, 'participants:', data.participants);
        // All peers receive all announcements via shared UDP listener
        // Host filters out their own room to avoid showing it in their own list
        if (isHosting && hostInfo && data.roomId === hostInfo.roomId) {
          console.log('[DISCOVERY] ignoring own announcement');
          return;
        }
        roomMap.set(data.roomId, { data, lastSeen: Date.now() });
        sendRoomsUpdate();
      } else {
        console.log('[DISCOVERY] Received non-announce message or invalid data');
      }
    } catch (e) {
      console.error('[DISCOVERY] Failed to parse message:', e.message);
      console.error('[DISCOVERY] Raw message (first 100 chars):', msg.toString().substring(0, 100));
    }
  });

  // Bind to all interfaces (0.0.0.0) to receive multicast on any network adapter
  discoverySocket.bind(MULTICAST_PORT, '0.0.0.0', () => {
    try {
      const localIp = getLocalIp();
      console.log('[DISCOVERY] Binding to 0.0.0.0:' + MULTICAST_PORT + ' (local IP:', localIp + ')');
      
      // CRITICAL: Join multicast group on the SPECIFIC network interface
      // When binding to 0.0.0.0, we must specify which interface to use for multicast
      // This is often the issue - multicast membership needs the interface IP
      try {
        discoverySocket.addMembership(MULTICAST_ADDR, localIp);
        console.log('[DISCOVERY] Joined multicast group', MULTICAST_ADDR, 'on interface', localIp);
      } catch (e) {
        // Fallback: try without specifying interface (may work on some systems)
        console.log('[DISCOVERY] Failed to join with interface, trying without:', e.message);
        try {
          discoverySocket.addMembership(MULTICAST_ADDR);
          console.log('[DISCOVERY] Joined multicast group', MULTICAST_ADDR, 'without interface spec');
        } catch (e2) {
          throw e2;
        }
      }
      
      // Enable loopback so sender also receives (useful for testing)
      discoverySocket.setMulticastLoopback(true);
      console.log('[DISCOVERY] Multicast loopback enabled');
      
      // Set TTL for multicast packets (1 = local network only)
      discoverySocket.setMulticastTTL(1);
      console.log('[DISCOVERY] Multicast TTL set to 1 (local network)');
      
      // Set multicast interface for sending (should match the interface we joined on)
      try {
        discoverySocket.setMulticastInterface(localIp);
        console.log('[DISCOVERY] Multicast send interface set to', localIp);
      } catch (e) {
        console.log('[DISCOVERY] Could not set multicast send interface (may still work):', e.message);
      }
      
      console.log('[DISCOVERY] Successfully joined multicast group', MULTICAST_ADDR);
      console.log('[DISCOVERY] Multicast ready - listening for room announcements');
    } catch (e) {
      console.error('[DISCOVERY] Failed to join multicast group:', e);
      console.error('[DISCOVERY] Possible causes:');
      console.error('  - Windows Firewall blocking UDP port', MULTICAST_PORT);
      console.error('  - Network adapter does not support multicast');
      console.error('  - Insufficient permissions');
      console.error('  - Error details:', e.message);
    }
  });

  // Log when socket is actually listening
  discoverySocket.on('listening', () => {
    const address = discoverySocket.address();
    console.log('[DISCOVERY] Socket listening on', address.address + ':' + address.port);
    console.log('[DISCOVERY] Ready to receive multicast packets');
    
    // Test: Send a test packet to ourselves to verify socket is working
    // This will only work if loopback is enabled
    setTimeout(() => {
      const testMsg = Buffer.from(JSON.stringify({ t: 'test', ts: Date.now() }));
      try {
        discoverySocket.send(testMsg, 0, testMsg.length, MULTICAST_PORT, MULTICAST_ADDR, (err) => {
          if (err) {
            console.log('[DISCOVERY] Test send failed (this is OK if firewall blocks):', err.message);
          } else {
            console.log('[DISCOVERY] Test packet sent - if loopback works, you should see it received');
          }
        });
      } catch (e) {
        console.log('[DISCOVERY] Test send exception:', e.message);
      }
    }, 1000);
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

// Start announcing this peer's room via UDP multicast
// Uses the shared discoverySocket (created at startup) to broadcast announcements
function startAnnouncing(roomId, roomName, wsPort) {
  const ip = getLocalIp();
  hostInfo = { roomId, roomName, hostIp: ip, wsPort };
  if (announceInterval) clearInterval(announceInterval);
  
  // Send first announcement immediately
  const sendAnnouncement = () => {
    if (!discoverySocket) {
      console.error('[ANNOUNCE] Cannot send - discovery socket not ready');
      return;
    }
    // Count all WebSocket clients (host is now also a client, so just count clients)
    const participants = clientIdToSocket.size;
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
      // Send to multicast address - all peers listening on this group will receive it
      discoverySocket.send(buf, 0, buf.length, MULTICAST_PORT, MULTICAST_ADDR, (err) => {
        if (err) {
          console.error('[ANNOUNCE] Send error:', err.message);
          console.error('[ANNOUNCE] Check Windows Firewall allows UDP', MULTICAST_PORT);
          console.error('[ANNOUNCE] Verify multicast is enabled on network adapter');
        } else {
          console.log('[ANNOUNCE] Sent to', MULTICAST_ADDR + ':' + MULTICAST_PORT, '- roomId:', roomId, 'name:', roomName, 'participants:', participants);
        }
      });
    } catch (e) {
      console.error('[ANNOUNCE] Send exception:', e.message);
    }
  };
  
  // Send immediately, then every 2 seconds
  sendAnnouncement();
  announceInterval = setInterval(sendAnnouncement, 2000);
  console.log('[ANNOUNCE] Started announcing room', roomId, 'name:', roomName, 'at', `${ip}:${wsPort}`);
  console.log('[ANNOUNCE] Sending to multicast group', MULTICAST_ADDR + ':' + MULTICAST_PORT);
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
    isInMeeting = true;
    updateTrayIcon();
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
  isInMeeting = false;
  updateTrayIcon();
  return { ok: true };
});

// Track meeting state from renderer
ipcMain.handle('meeting:join', () => {
  console.log('[IPC] meeting:join');
  isInMeeting = true;
  updateTrayIcon();
  return { ok: true };
});

ipcMain.handle('meeting:leave', () => {
  console.log('[IPC] meeting:leave');
  isInMeeting = false;
  updateTrayIcon();
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  // Start discovery immediately at app launch - all peers listen for room announcements
  // This happens before any room is created, ensuring peers can discover rooms at any time
  startDiscovery();
  console.log('[APP] ready - discovery socket active');

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

// Don't quit when all windows are closed - keep running in tray
app.on('window-all-closed', () => {
  console.log('[APP] window-all-closed - keeping app running in tray');
  // Don't call app.quit() - app stays running in tray
});

// Clean up on app quit
app.on('before-quit', () => {
  console.log('[APP] before-quit - cleaning up');
  stopAnnouncing();
  stopWsServer(false);
  stopDiscovery();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});


