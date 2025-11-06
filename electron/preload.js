const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lan', {
  getHostname: () => ipcRenderer.invoke('sys:get-hostname'),
  getLocalIp: () => ipcRenderer.invoke('sys:get-local-ip'),
  onRoomsUpdate: (cb) => {
    const listener = (_e, rooms) => cb && cb(rooms);
    ipcRenderer.on('rooms-update', listener);
    return () => ipcRenderer.removeListener('rooms-update', listener);
  },
  hostStart: (roomId, roomName, wsPort) => ipcRenderer.invoke('host:start', { roomId, roomName, wsPort }),
  hostStop: () => ipcRenderer.invoke('host:stop')
});


