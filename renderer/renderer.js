import { Discovery } from './discovery.js';
import { SignalingClient } from './signaling.js';
import { WebRTCManager } from './webrtc.js';
import { uuidv4, getDefaultRoomName, log } from './utils.js';

const roomsEl = document.getElementById('rooms');
const createRoomBtn = document.getElementById('createRoomBtn');
const exitBtn = document.getElementById('exitBtn');
const videoGrid = document.getElementById('videoGrid');
const roomNameInput = document.getElementById('roomNameInput');
const peerListEl = document.getElementById('peerList');

let currentRoom = null; // { mode: 'host'|'join', roomId, hostIp, wsPort }
let clientId = uuidv4();
let clientName = 'Guest';
let signaling = null;
let rtc = null;
let selectedPeerIds = new Set(); // Track selected peers for invitation
let shownInvitations = new Set(); // Track shown invitations to prevent duplicates

async function init() {
  clientName = await getDefaultRoomName();
  rtc = new WebRTCManager({ gridEl: videoGrid });
  log('[APP][renderer] init with name', clientName, 'clientId', clientId);

  // Initialize peer presence
  await window.lan.peerInit(clientId, clientName);

  Discovery.onRooms(renderRooms);
  window.lan.onPeersUpdate(renderPeers);
  window.lan.onInvitationReceived(handleInvitationReceived);
  window.lan.onShowNotification(showInAppNotification);

  createRoomBtn.onclick = onCreateRoom;
  exitBtn.onclick = onExit;
  
  // Allow Enter key to create room
  roomNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !createRoomBtn.disabled) {
      onCreateRoom();
    }
  });
}

function renderPeers(peers) {
  log('[UI][renderer] renderPeers count', peers.length);
  const list = peers || [];
  const currentPeerIds = new Set(list.map(p => p.peerId));
  
  // Find current user's peerId and remove from selected peers (can't invite yourself)
  const currentUser = list.find(p => p.isCurrentUser);
  if (currentUser && selectedPeerIds.has(currentUser.peerId)) {
    log('[UI][renderer] Removing current user from selection (cannot invite yourself)');
    selectedPeerIds.delete(currentUser.peerId);
  }
  
  // Clean up selected peers that are no longer online
  for (const peerId of selectedPeerIds) {
    if (!currentPeerIds.has(peerId)) {
      log('[UI][renderer] Removing offline peer from selection:', peerId);
      selectedPeerIds.delete(peerId);
    }
  }
  
  peerListEl.innerHTML = '';
  
  if (list.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'peer-list-empty';
    emptyMsg.textContent = 'No users online';
    peerListEl.appendChild(emptyMsg);
    return;
  }
  
  for (const peer of list) {
    const item = document.createElement('div');
    item.className = 'peer-item';
    if (peer.isCurrentUser) {
      item.classList.add('peer-item-current');
    }
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `peer-${peer.peerId}`;
    checkbox.checked = selectedPeerIds.has(peer.peerId);
    checkbox.disabled = peer.isCurrentUser || false; // Disable checkbox for current user
    checkbox.onchange = (e) => {
      if (e.target.checked) {
        selectedPeerIds.add(peer.peerId);
      } else {
        selectedPeerIds.delete(peer.peerId);
      }
      log('[UI][renderer] Selected peers:', Array.from(selectedPeerIds));
    };
    
    const label = document.createElement('label');
    label.htmlFor = `peer-${peer.peerId}`;
    label.className = 'peer-name';
    if (peer.isCurrentUser) {
      label.classList.add('peer-name-current');
    }
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = peer.peerName || 'Unknown';
    nameSpan.className = 'peer-name-text';
    
    const ipSpan = document.createElement('span');
    ipSpan.textContent = peer.peerIp || '';
    ipSpan.className = 'peer-ip';
    
    label.appendChild(nameSpan);
    label.appendChild(ipSpan);
    
    // Show "You" indicator for current user
    if (peer.isCurrentUser) {
      const currentUserSpan = document.createElement('span');
      currentUserSpan.textContent = '(You)';
      currentUserSpan.className = 'peer-current-indicator';
      label.appendChild(currentUserSpan);
    }
    
    // Show room status if peer is in a room
    if (peer.roomName) {
      const roomStatusSpan = document.createElement('span');
      roomStatusSpan.textContent = `joined ${peer.roomName}`;
      roomStatusSpan.className = 'peer-room-status';
      label.appendChild(roomStatusSpan);
    }
    
    item.appendChild(checkbox);
    item.appendChild(label);
    
    // Add invite button for host only
    if (currentRoom && currentRoom.mode === 'host' && !peer.isCurrentUser) {
      const inviteBtn = document.createElement('button');
      inviteBtn.textContent = 'Invite';
      inviteBtn.className = 'peer-invite-btn';
      inviteBtn.disabled = !!peer.roomName; // Disable if peer is already in a room
      inviteBtn.onclick = async () => {
        if (!currentRoom || currentRoom.mode !== 'host') return;
        try {
          log('[UI][renderer] Sending invitation to', peer.peerId, 'for room', currentRoom.roomName);
          await window.lan.peerSendInvitation(
            currentRoom.roomId,
            currentRoom.roomName,
            currentRoom.hostIp,
            currentRoom.wsPort,
            [peer.peerId]
          );
          log('[FLOW][renderer] Sent invitation to', peer.peerId);
          // Show notification on host side
          showInAppNotification(`Invite was sent to ${peer.peerName || peer.peerId}`);
        } catch (e) {
          console.error('[FLOW][renderer] Error sending invitation:', e);
        }
      };
      item.appendChild(inviteBtn);
    }
    
    peerListEl.appendChild(item);
  }
}

function handleInvitationReceived(data) {
  log('[FLOW][renderer] Invitation received', data);
  const { roomId, roomName, hostIp, wsPort } = data;
  
  // Create unique key for this invitation to prevent duplicates
  const invitationKey = `${roomId}-${hostIp}-${wsPort}`;
  
  // Check if we've already shown this invitation
  if (shownInvitations.has(invitationKey)) {
    log('[FLOW][renderer] Invitation already shown, skipping duplicate');
    return;
  }
  
  // Mark this invitation as shown
  shownInvitations.add(invitationKey);
  
  // Show notification - user can manually join by clicking the room button
  showInAppNotification(`You've invited to ${roomName}. Please join now.`);
  
  // Room will appear in the room list via normal announcement mechanism
  // User can click the room button to join manually
}

function showInAppNotification(message) {
  // Check if a notification with the same message already exists
  const existingNotifications = document.querySelectorAll('.notification-banner .notification-message');
  for (const existing of existingNotifications) {
    if (existing.textContent === message) {
      log('[UI][renderer] Notification with same message already exists, skipping duplicate');
      return;
    }
  }
  
  // Create a notification banner
  const notification = document.createElement('div');
  notification.className = 'notification-banner';
  
  const messageText = document.createElement('span');
  messageText.className = 'notification-message';
  messageText.textContent = message;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'notification-close';
  closeBtn.innerHTML = '×';
  closeBtn.setAttribute('aria-label', 'Close notification');
  closeBtn.onclick = () => {
    notification.classList.add('fade-out');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  };
  
  notification.appendChild(messageText);
  notification.appendChild(closeBtn);
  document.body.appendChild(notification);
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
  currentRoom = { mode: 'host', roomId: host.roomId, roomName: host.roomName, hostIp, wsPort: host.wsPort };
  
  // Send invitations to selected peers
  if (selectedPeerIds.size > 0) {
    const targetPeerIds = Array.from(selectedPeerIds);
    await window.lan.peerSendInvitation(
      host.roomId,
      host.roomName,
      hostIp,
      host.wsPort,
      targetPeerIds
    );
    log('[FLOW][renderer] Sent invitations to', targetPeerIds.length, 'peers');
  }
  
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
        // Host creates offers to existing participants using deterministic rule
        // Lower clientId creates offer to avoid duplicate connections
        for (const p of participants) {
          // Only create offer if we don't already have a connection to this peer
          if (!rtc.hasPeer(p.clientId)) {
            // Only create offer if host has lower clientId (deterministic rule for full mesh)
            if (clientId < p.clientId) {
              try {
                const offer = await rtc.createOfferTo(p.clientId, (candidate) => signaling.sendIce(p.clientId, candidate));
                if (offer) {
                  signaling.sendOffer(p.clientId, offer);
                }
              } catch (e) {
                log('[FLOW][renderer][HOST] Error creating offer to', p.clientId, ':', e.message);
              }
            } else {
              log('[FLOW][renderer][HOST] Waiting for', p.clientId, 'to create offer (they have lower ID)');
            }
          }
        }
      },
      onPeerJoined: async ({ clientId: peerId }) => {
        log('[FLOW][renderer][HOST] onPeerJoined', peerId);
        // When new peer joins, host creates offer if host has lower clientId
        // This ensures full mesh connectivity with deterministic offer creation
        if (!rtc.hasPeer(peerId)) {
          if (clientId < peerId) {
            try {
              const offer = await rtc.createOfferTo(peerId, (candidate) => signaling.sendIce(peerId, candidate));
              if (offer) {
                signaling.sendOffer(peerId, offer);
              }
            } catch (e) {
              log('[FLOW][renderer][HOST] Error creating offer to', peerId, ':', e.message);
            }
          } else {
            log('[FLOW][renderer][HOST] Waiting for', peerId, 'to create offer (they have lower ID)');
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
    // Notify main process that we're in a meeting (host:start already did this, but ensure it)
    await window.lan.meetingJoin(currentRoom.roomName);
  } catch (e) {
    console.error('[FLOW][renderer][HOST] signaling connect failed', e);
    alert('Failed to connect to own signaling server');
    onExit();
  }
}

async function joinRoom(room) {
  if (currentRoom) return;
  log('[FLOW][renderer] joinRoom', room.roomId, `${room.hostIp}:${room.wsPort}`);
  currentRoom = { mode: 'join', roomId: room.roomId, roomName: room.roomName, hostIp: room.hostIp, wsPort: room.wsPort };
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
        // Participant creates offers to all existing participants for full mesh
        // Use deterministic rule: lower clientId creates offer to avoid conflicts
        for (const p of participants) {
          if (!rtc.hasPeer(p.clientId)) {
            // Only create offer if our clientId is "lower" (lexicographically) to avoid duplicate offers
            // If the other peer has a lower ID, they will create the offer instead
            if (clientId < p.clientId) {
              try {
                log('[FLOW][renderer] Creating offer to existing participant', p.clientId);
                const offer = await rtc.createOfferTo(p.clientId, (candidate) => signaling.sendIce(p.clientId, candidate));
                if (offer) {
                  signaling.sendOffer(p.clientId, offer);
                }
              } catch (e) {
                log('[FLOW][renderer] Error creating offer to', p.clientId, ':', e.message);
              }
            } else {
              log('[FLOW][renderer] Waiting for', p.clientId, 'to create offer (they have lower ID)');
            }
          }
        }
      },
      onPeerJoined: async ({ clientId: peerId }) => {
        log('[FLOW][renderer] onPeerJoined', peerId);
        // When a new peer joins, create offer to them if we have lower clientId
        // This ensures full mesh connectivity
        if (!rtc.hasPeer(peerId)) {
          if (clientId < peerId) {
            try {
              log('[FLOW][renderer] Creating offer to new participant', peerId);
              const offer = await rtc.createOfferTo(peerId, (candidate) => signaling.sendIce(peerId, candidate));
              if (offer) {
                signaling.sendOffer(peerId, offer);
              }
            } catch (e) {
              log('[FLOW][renderer] Error creating offer to', peerId, ':', e.message);
            }
          } else {
            log('[FLOW][renderer] Waiting for', peerId, 'to create offer (they have lower ID)');
          }
        }
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
    // Notify main process that we're in a meeting
    await window.lan.meetingJoin(currentRoom.roomName);
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

  // Notify main process that we left the meeting
  await window.lan.meetingLeave();

  currentRoom = null;
  createRoomBtn.disabled = false;
  roomNameInput.disabled = false;
  exitBtn.disabled = true;
}

init();


