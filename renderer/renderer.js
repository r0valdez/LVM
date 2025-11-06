import { Discovery } from './discovery.js';
import { SignalingClient } from './signaling.js';
import { WebRTCManager } from './webrtc.js';
import { uuidv4, getDefaultRoomName, log } from './utils.js';

const roomsEl = document.getElementById('rooms');
const createRoomBtn = document.getElementById('createRoomBtn');
const exitBtn = document.getElementById('exitBtn');
const videoGrid = document.getElementById('videoGrid');

let currentRoom = null; // { mode: 'host'|'join', roomId, hostIp, wsPort }
let clientId = uuidv4();
let clientName = 'Guest';
let signaling = null;
let rtc = null;

async function init() {
  clientName = await getDefaultRoomName();
  rtc = new WebRTCManager({ gridEl: videoGrid });

  Discovery.onRooms(renderRooms);

  createRoomBtn.onclick = onCreateRoom;
  exitBtn.onclick = onExit;
}

function renderRooms(rooms) {
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

    btn.onclick = () => joinRoom(room);
    roomsEl.appendChild(wrap);
  }
}

async function onCreateRoom() {
  if (currentRoom) return;
  const host = await Discovery.startHosting(57788);
  currentRoom = { mode: 'host', roomId: host.roomId, hostIp: await window.lan.getLocalIp(), wsPort: host.wsPort };
  createRoomBtn.disabled = true;
  exitBtn.disabled = false;
  // Host doesn't connect as WS client; only shows self and waits for peers
  await rtc.initLocal(clientId);
}

async function joinRoom(room) {
  if (currentRoom) return;
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
        // Create offers to existing participants
        for (const p of participants) {
          const offer = await rtc.createOfferTo(p.clientId, (candidate) => signaling.sendIce(p.clientId, candidate));
          signaling.sendOffer(p.clientId, offer);
        }
      },
      onPeerJoined: async ({ clientId: peerId }) => {
        const offer = await rtc.createOfferTo(peerId, (candidate) => signaling.sendIce(peerId, candidate));
        signaling.sendOffer(peerId, offer);
      },
      onPeerLeft: ({ clientId: peerId }) => {
        rtc.removePeer(peerId);
      },
      onSignal: async (msg) => {
        const from = msg.from;
        if (msg.t === 'offer') {
          const answer = await rtc.handleOffer(from, msg.sdp, (candidate) => signaling.sendIce(from, candidate));
          signaling.sendAnswer(from, answer);
        } else if (msg.t === 'answer') {
          await rtc.handleAnswer(from, msg.sdp);
        } else if (msg.t === 'ice') {
          await rtc.handleIce(from, msg.candidate);
        }
      },
      onEnd: () => {
        alert('Host ended the meeting.');
        onExit();
      },
      onClosed: () => {
        if (currentRoom) onExit();
      }
    }
  });

  try {
    await signaling.connect();
  } catch (e) {
    alert('Failed to connect to room');
    onExit();
  }
}

async function onExit() {
  if (!currentRoom) return;
  if (currentRoom.mode === 'host') {
    await Discovery.stopHosting();
  } else if (currentRoom.mode === 'join') {
    try { signaling && signaling.leave(); } catch {}
    try { signaling && signaling.close(); } catch {}
    signaling = null;
  }

  rtc.cleanup();

  currentRoom = null;
  createRoomBtn.disabled = false;
  exitBtn.disabled = true;
}

init();


