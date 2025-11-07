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

2) Start the app (development mode)

```bash
npm start
```

Run on two Windows PCs on the same LAN. Allow the app through Windows Firewall for UDP 55555 and TCP 57788 when prompted.

## Building Standalone Executable

### Install electron-builder (if not already installed)

```bash
npm install
```

### Build Options

**Build for Windows (creates both installer and portable):**
```bash
npm run build:win
```

**Build portable executable only (no installer):**
```bash
npm run build:dir
```

**Build with all default settings:**
```bash
npm run build
```

### Output

Built executables will be in the `dist/` folder:
- **NSIS Installer**: `LVM Setup 1.0.0.exe` - Full installer with options to choose installation directory
- **Portable**: `LVM-1.0.0-portable.exe` - Standalone executable that can run without installation

### Build Configuration

The build is configured in `package.json` under the `build` section:
- **App ID**: `com.lvm.app`
- **Product Name**: `LVM`
- **Output Directory**: `dist/`
- **Windows Targets**: NSIS installer (x64) and Portable executable (x64)

### Icon (Optional)

To add a custom icon, place `icon.ico` in a `build/` folder. If no icon is provided, electron-builder will use a default icon.

### Offline Build Setup

**Important:** `electron-builder` requires Electron binaries to be cached locally. The first build needs internet to download them (~100-200MB).

**First Time Setup (Requires Internet - One Time Only):**
```bash
npm install                    # Install all dependencies including Electron
npm run build:dir             # This downloads and caches Electron binaries to local cache
```

**After First Build (Works Completely Offline):**
```bash
npm run build:dir             # Uses cached Electron binaries, no internet needed
npm run build:win            # Works offline
npm run build                # Works offline
```

**Cache Location:**
- **Windows**: `%LOCALAPPDATA%\electron-builder\Cache\electron\31.7.7\electron-v31.7.7-win32-x64.zip`
- **macOS**: `~/Library/Caches/electron-builder/electron/31.7.7/electron-v31.7.7-darwin-x64.zip`
- **Linux**: `~/.cache/electron-builder/electron/31.7.7/electron-v31.7.7-linux-x64.zip`

**Copying Cache from Another Machine:**
If you have the cache on another machine, you can copy the entire `electron-builder/Cache` folder to the same location on the offline machine to enable offline builds immediately.

### Notes
- The first build downloads Electron binaries (~100-200MB) and caches them locally
- After the first build, all subsequent builds work completely offline
- Built executables are self-contained and don't require Node.js or npm to run
- The portable version can be run directly without installation

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

### UDP Multicast Discovery Issues

**How UDP Multicast Works:**
- All peers join multicast group `239.255.255.250` on UDP port `55555`
- Host sends announcements every 2 seconds to this multicast address
- All peers on the same LAN receive these announcements automatically
- No central server needed - pure peer-to-peer discovery

**What Can Block Multicast Packets:**

1. **Windows Firewall** (Most Common)
   - Windows will prompt to allow the app when first run
   - If blocked, manually add rules:
     - Open Windows Defender Firewall → Advanced Settings
     - Inbound Rules → New Rule → Port → UDP → Specific: `55555`
     - Allow the connection → Apply to all profiles
   - Check console logs for `[ANNOUNCE] Send error` or `[DISCOVERY] Failed to join multicast group`

2. **Network Switches/Routers**
   - Most modern switches support multicast (IGMP)
   - Older or managed switches may block multicast traffic
   - Check if other multicast apps work on your network
   - Some corporate networks disable multicast for security

3. **Network Isolation**
   - Peers must be on the **same subnet** (e.g., both on `192.168.1.x`)
   - VLANs or network segmentation can isolate peers
   - Different subnets require multicast routing (rarely configured)

4. **Network Adapter Settings**
   - Some network adapters have multicast filtering disabled
   - Check adapter properties → Advanced → "Multicast Receive" should be enabled
   - Virtual network adapters (VPNs, VMs) may not support multicast properly

5. **Antivirus/Security Software**
   - May block UDP traffic or network discovery
   - Temporarily disable to test, then add exception

6. **Multiple Network Interfaces**
   - If PC has multiple network adapters, multicast may bind to wrong interface
   - Check console logs for which IP address is being used
   - Ensure all peers are on the same physical network segment

**Testing Multicast:**
- Check console logs: `[DISCOVERY] Socket listening on` should appear
- Host should see: `[ANNOUNCE] roomId: ...` every 2 seconds
- Peers should see: `[DISCOVERY] announce received` when host creates room
- If no announcements received, check Windows Firewall first

**Other Issues:**
- If rooms do not appear: check multicast not blocked on the network and Windows Firewall rules
- If media fails: ensure camera/microphone permissions are allowed for Electron
- WebRTC is LAN-only (no ICE servers); it won't connect across subnets without direct routing


