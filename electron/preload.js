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
  }
});


