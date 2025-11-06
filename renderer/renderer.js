import { Discovery } from './discovery.js';
import { SignalingClient } from './signaling.js';
import { WebRTCManager } from './webrtc.js';
import { uuidv4, getDefaultRoomName, log } from './utils.js';

const roomsEl = document.getElementById('rooms');
const createRoomBtn = document.getElementById('createRoomBtn');
const exitBtn = document.getElementById('exitBtn');
const videoGrid = document.getElementById('videoGrid');
const roomNameInput = document.getElementById('roomNameInput');

let currentRoom = null; // { mode: 'host'|'join', roomId, hostIp, wsPort }
let clientId = uuidv4();
let clientName = 'Guest';
let signaling = null;
let rtc = null;

async function init() {
  clientName = await getDefaultRoomName();
  rtc = new WebRTCManager({ gridEl: videoGrid });
  log('[APP][renderer] init with name', clientName, 'clientId', clientId);

  Discovery.onRooms(renderRooms);

  createRoomBtn.onclick = onCreateRoom;
  exitBtn.onclick = onExit;
  
  // Allow Enter key to create room
  roomNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !createRoomBtn.disabled) {
      onCreateRoom();
    }
  });
}

function renderRooms(rooms) {
  log('[UI][renderer] renderRooms count', rooms.length);
  roomsEl.innerHTML = '';
  const list = rooms || [];
  for (const room of list) {
    const btn = document.createElement('button');
    btn.className = 'room-button';
    btn.textContent = `${room.roomName}`;
    const meta = document.createElement('div');
    meta.className = 'room-meta';
    meta.textContent = `${room.hostIp}:${room.wsPort} · ${room.participants} online`;
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '2px';
    wrap.appendChild(btn);
    wrap.appendChild(meta);

    if (currentRoom && currentRoom.roomId === room.roomId) btn.classList.add('active');

    btn.onclick = () => {
      log('[UI][renderer] click room', room.roomId, room.roomName);
      joinRoom(room);
    };
    roomsEl.appendChild(wrap);
  }
}

async function onCreateRoom() {
  if (currentRoom) return;
  log('[UI][renderer] Create Room clicked');
  const customRoomName = roomNameInput.value;
  const host = await Discovery.startHosting(57788, customRoomName);
  const hostIp = await window.lan.getLocalIp();
  currentRoom = { mode: 'host', roomId: host.roomId, hostIp, wsPort: host.wsPort };
  createRoomBtn.disabled = true;
  roomNameInput.disabled = true;
  exitBtn.disabled = false;
  
  await rtc.initLocal(clientId);
  
  // Host must also connect as WebSocket client to participate in WebRTC signaling
  signaling = new SignalingClient({
    url: `ws://${hostIp}:${host.wsPort}`,
    clientId,
    name: clientName,
    handlers: {
      onWelcome: async ({ participants }) => {
        log('[FLOW][renderer][HOST] onWelcome participants', participants.length);
        // Host creates offers to existing participants (host is always the offerer)
        for (const p of participants) {
          // Only create offer if we don't already have a connection to this peer
          if (!rtc.hasPeer(p.clientId)) {
            try {
              const offer = await rtc.createOfferTo(p.clientId, (candidate) => signaling.sendIce(p.clientId, candidate));
              if (offer) {
                signaling.sendOffer(p.clientId, offer);
              }
            } catch (e) {
              log('[FLOW][renderer][HOST] Error creating offer to', p.clientId, ':', e.message);
            }
          }
        }
      },
      onPeerJoined: async ({ clientId: peerId }) => {
        log('[FLOW][renderer][HOST] onPeerJoined', peerId);
        // When new peer joins, host creates offer to them (host is always the offerer)
        if (!rtc.hasPeer(peerId)) {
          try {
            const offer = await rtc.createOfferTo(peerId, (candidate) => signaling.sendIce(peerId, candidate));
            if (offer) {
              signaling.sendOffer(peerId, offer);
            }
          } catch (e) {
            log('[FLOW][renderer][HOST] Error creating offer to', peerId, ':', e.message);
          }
        }
      },
      onPeerLeft: ({ clientId: peerId }) => {
        log('[FLOW][renderer][HOST] onPeerLeft', peerId);
        rtc.removePeer(peerId);
      },
      onSignal: async (msg) => {
        const from = msg.from;
        if (msg.t === 'offer') {
          log('[FLOW][renderer][HOST] recv offer from', from);
          try {
            const answer = await rtc.handleOffer(from, msg.sdp, (candidate) => signaling.sendIce(from, candidate));
            if (answer) {
              signaling.sendAnswer(from, answer);
            }
          } catch (e) {
            log('[FLOW][renderer][HOST] Error handling offer from', from, ':', e.message);
          }
        } else if (msg.t === 'answer') {
          log('[FLOW][renderer][HOST] recv answer from', from);
          try {
            await rtc.handleAnswer(from, msg.sdp);
          } catch (e) {
            log('[FLOW][renderer][HOST] Error handling answer from', from, ':', e.message);
          }
        } else if (msg.t === 'ice') {
          log('[FLOW][renderer][HOST] recv ice from', from);
          await rtc.handleIce(from, msg.candidate);
        }
      },
      onEnd: () => {
        log('[FLOW][renderer][HOST] onEnd (should not happen for host)');
      },
      onClosed: () => {
        log('[FLOW][renderer][HOST] WS closed');
        if (currentRoom && currentRoom.mode === 'host') {
          // Reconnect if we're still hosting
          setTimeout(() => {
            if (currentRoom && currentRoom.mode === 'host') {
              log('[FLOW][renderer][HOST] Attempting to reconnect...');
              onCreateRoom(); // Re-establish connection
            }
          }, 1000);
        }
      }
    }
  });

  try {
    log('[FLOW][renderer][HOST] signaling.connect to own server');
    await signaling.connect();
  } catch (e) {
    console.error('[FLOW][renderer][HOST] signaling connect failed', e);
    alert('Failed to connect to own signaling server');
    onExit();
  }
}

async function joinRoom(room) {
  if (currentRoom) return;
  log('[FLOW][renderer] joinRoom', room.roomId, `${room.hostIp}:${room.wsPort}`);
  currentRoom = { mode: 'join', roomId: room.roomId, hostIp: room.hostIp, wsPort: room.wsPort };
  createRoomBtn.disabled = true;
  exitBtn.disabled = false;

  await rtc.initLocal(clientId);

  signaling = new SignalingClient({
    url: `ws://${room.hostIp}:${room.wsPort}`,
    clientId,
    name: clientName,
    handlers: {
      onWelcome: async ({ participants }) => {
        log('[FLOW][renderer] onWelcome participants', participants.length);
        // Peer waits for host to create offers - don't create offers here
        // The host will create offers, and we'll answer them
        log('[FLOW][renderer] Waiting for host to initiate WebRTC connection');
      },
      onPeerJoined: async ({ clientId: peerId }) => {
        log('[FLOW][renderer] onPeerJoined', peerId);
        // Peer waits for others to create offers - don't create offers here
        log('[FLOW][renderer] Waiting for', peerId, 'to initiate WebRTC connection');
      },
      onPeerLeft: ({ clientId: peerId }) => {
        log('[FLOW][renderer] onPeerLeft', peerId);
        rtc.removePeer(peerId);
      },
      onSignal: async (msg) => {
        const from = msg.from;
        if (msg.t === 'offer') {
          log('[FLOW][renderer] recv offer from', from);
          try {
            const answer = await rtc.handleOffer(from, msg.sdp, (candidate) => signaling.sendIce(from, candidate));
            if (answer) {
              signaling.sendAnswer(from, answer);
            }
          } catch (e) {
            log('[FLOW][renderer] Error handling offer from', from, ':', e.message);
          }
        } else if (msg.t === 'answer') {
          log('[FLOW][renderer] recv answer from', from);
          try {
            await rtc.handleAnswer(from, msg.sdp);
          } catch (e) {
            log('[FLOW][renderer] Error handling answer from', from, ':', e.message);
          }
        } else if (msg.t === 'ice') {
          log('[FLOW][renderer] recv ice from', from);
          await rtc.handleIce(from, msg.candidate);
        }
      },
      onEnd: () => {
        log('[FLOW][renderer] onEnd (host ended)');
        alert('Host ended the meeting.');
        onExit();
      },
      onClosed: () => {
        log('[FLOW][renderer] WS closed');
        if (currentRoom) onExit();
      }
    }
  });

  try {
    log('[FLOW][renderer] signaling.connect');
    await signaling.connect();
  } catch (e) {
    console.error('[FLOW][renderer] signaling connect failed', e);
    alert('Failed to connect to room');
    onExit();
  }
}

async function onExit() {
  if (!currentRoom) return;
  log('[UI][renderer] Exit clicked, mode =', currentRoom.mode);
  if (currentRoom.mode === 'host') {
    // Host: close signaling connection and stop hosting
    try { signaling && signaling.leave(); } catch {}
    try { signaling && signaling.close(); } catch {}
    signaling = null;
    await Discovery.stopHosting();
  } else if (currentRoom.mode === 'join') {
    // Participant: just leave
    try { signaling && signaling.leave(); } catch {}
    try { signaling && signaling.close(); } catch {}
    signaling = null;
  }

  rtc.cleanup();

  currentRoom = null;
  createRoomBtn.disabled = false;
  roomNameInput.disabled = false;
  exitBtn.disabled = true;
}

init();


