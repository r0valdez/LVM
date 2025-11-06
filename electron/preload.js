const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lan', {
  getHostname: () => {
    console.log('[PRELOAD] getHostname');
    return ipcRenderer.invoke('sys:get-hostname');
  },
  getLocalIp: () => {
    console.log('[PRELOAD] getLocalIp');
    return ipcRenderer.invoke('sys:get-local-ip');
  },
  onRoomsUpdate: (cb) => {
    const listener = (_e, rooms) => cb && cb(rooms);
    ipcRenderer.on('rooms-update', listener);
    console.log('[PRELOAD] rooms-update listener registered');
    return () => ipcRenderer.removeListener('rooms-update', listener);
  },
  hostStart: (roomId, roomName, wsPort) => {
    console.log('[PRELOAD] hostStart', roomId, roomName, wsPort);
    return ipcRenderer.invoke('host:start', { roomId, roomName, wsPort });
  },
  hostStop: () => {
    console.log('[PRELOAD] hostStop');
    return ipcRenderer.invoke('host:stop');
  },
  meetingJoin: () => {
    console.log('[PRELOAD] meetingJoin');
    return ipcRenderer.invoke('meeting:join');
  },
  meetingLeave: () => {
    console.log('[PRELOAD] meetingLeave');
    return ipcRenderer.invoke('meeting:leave');
  },
  peerInit: (peerId, peerName) => {
    console.log('[PRELOAD] peerInit', peerId, peerName);
    return ipcRenderer.invoke('peer:init', { peerId, peerName });
  },
  peerSendInvitation: (roomId, roomName, hostIp, wsPort, targetPeerIds) => {
    console.log('[PRELOAD] peerSendInvitation');
    return ipcRenderer.invoke('peer:send-invitation', { roomId, roomName, hostIp, wsPort, targetPeerIds });
  },
  onPeersUpdate: (cb) => {
    const listener = (_e, peers) => cb && cb(peers);
    ipcRenderer.on('peers-update', listener);
    console.log('[PRELOAD] peers-update listener registered');
    // Request initial peer list
    ipcRenderer.invoke('peer:get-list').then((peers) => {
      if (peers) cb(peers);
    });
    return () => ipcRenderer.removeListener('peers-update', listener);
  },
  onInvitationReceived: (cb) => {
    const listener = (_e, data) => cb && cb(data);
    ipcRenderer.on('invitation-received', listener);
    console.log('[PRELOAD] invitation-received listener registered');
    return () => ipcRenderer.removeListener('invitation-received', listener);
  },
  onShowNotification: (cb) => {
    const listener = (_e, message) => cb && cb(message);
    ipcRenderer.on('show-notification', listener);
    console.log('[PRELOAD] show-notification listener registered');
    return () => ipcRenderer.removeListener('show-notification', listener);
  }
});


