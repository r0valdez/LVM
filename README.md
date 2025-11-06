# LAN Video Meeting (Electron + WebRTC + WebSocket)

Windows desktop app for local-network video meetings with peer-to-peer media and local-only discovery/signaling. No cloud servers.

## Features
- UDP multicast discovery on `239.255.255.250:55555`
- Host app runs a local WebSocket signaling server on `57788`
- Participants connect over LAN, pure P2P WebRTC (no STUN/TURN)
- 4×4 video grid (self + remote videos)
- Simple Electron UI (Create Room, Exit, list of rooms)

## Getting Started

1) Install dependencies

```bash
npm install
```

2) Start the app

```bash
npm start
```

Run on two Windows PCs on the same LAN. Allow the app through Windows Firewall for UDP 55555 and TCP 57788 when prompted.

## How It Works
- Host clicks Create Room: starts WebSocket server and begins UDP heartbeat announces every 2s
- Other apps discover rooms and list them; click to join
- Host relays signaling messages (join/offer/answer/ice/leave/end) between participants
- WebRTC uses `new RTCPeerConnection({ iceServers: [] })` (LAN-only)

## Project Structure
```
lan-video-meeting/
  electron/
    main.js        // BrowserWindow + UDP discovery + WS host relay
    preload.js     // Exposes minimal IPC APIs to renderer
  renderer/
    index.html
    renderer.js    // UI controller: discovery, signaling, WebRTC wiring
    ui.css
    discovery.js   // Subscribe to rooms, start/stop hosting via IPC
    signaling.js   // Participant WebSocket client
    webrtc.js      // PeerConnections, local/remote tracks, grid management
    utils.js
  package.json
  .gitignore
  README.md
```

## Notes
- Rooms are removed if not seen for 6s
- Host exit ends meeting for everyone
- Participant exit leaves meeting without ending the room

## Troubleshooting
- If rooms do not appear: check multicast not blocked on the network and Windows Firewall rules
- If media fails: ensure camera/microphone permissions are allowed for Electron
- WebRTC is LAN-only (no ICE servers); it won’t connect across subnets without direct routing


