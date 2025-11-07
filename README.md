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

#### Step 1: Prepare on PC with Internet (One Time Only)

On a PC with internet connection, run:

```bash
npm install                    # Install all dependencies including Electron
npm run build:dir             # This downloads and caches Electron binaries to local cache
```

This will:
- Install all npm dependencies (including Electron and electron-builder)
- Download and cache Electron binaries (~100-200MB) to your local cache directory

#### Step 2: Check What to Copy

Run the preparation script to see what needs to be copied:

```bash
npm run prepare-offline
```

This will show you:
- Project files status
- `node_modules/` directory size and location
- Electron cache location and size
- Detailed copy instructions

#### Step 3: Copy Files to Offline PC

You need to copy **3 things** to the offline PC:

**1. Entire Project Folder (including `node_modules/`):**
   - Copy the entire project directory including:
     - All source files (`electron/`, `renderer/`, `scripts/`, etc.)
     - `node_modules/` directory (required!)
     - `package.json` and `package-lock.json`
   - You can zip the entire project folder and extract it on the offline PC

**2. Electron Cache Directory:**
   - **Windows**: Copy from `%LOCALAPPDATA%\electron-builder\Cache` 
     - Full path: `C:\Users\<YourUsername>\AppData\Local\electron-builder\Cache`
   - **macOS**: Copy from `~/Library/Caches/electron-builder`
   - **Linux**: Copy from `~/.cache/electron-builder`
   - Copy the **entire `Cache` folder** to the **same location** on the offline PC
   - Create the directory structure if it doesn't exist on the offline PC

**3. (Optional) npm Cache for electron-builder:**
   - If you want to be extra safe, also copy npm's cache for electron-builder
   - **Windows**: `%APPDATA%\npm-cache` or `%LOCALAPPDATA%\npm-cache`
   - **macOS/Linux**: `~/.npm`

#### Step 4: Build on Offline PC

On the offline PC:

1. **Verify cache location exists:**
   - Check that the Electron cache was copied to the correct location
   - Run `npm run prepare-offline` to verify

2. **Build (no internet required):**
   ```bash
   npm run build:dir             # Uses cached Electron binaries, no internet needed
   npm run build:win            # Works offline
   npm run build                # Works offline
   ```
   
   **Important:** The build scripts now use a wrapper that forces offline mode and prevents any GitHub downloads. If you still see download attempts, verify:
   - `node_modules/electron/dist` exists (Electron is installed)
   - Electron cache is in the correct location (run `npm run prepare-offline` to verify)

#### Cache Locations Reference

**Electron Cache (Required):**
- **Windows**: `%LOCALAPPDATA%\electron-builder\Cache\electron\31.7.7\electron-v31.7.7-win32-x64.zip`
- **macOS**: `~/Library/Caches/electron-builder/electron/31.7.7/electron-v31.7.7-darwin-x64.zip`
- **Linux**: `~/.cache/electron-builder/electron/31.7.7/electron-v31.7.7-linux-x64.zip`

**What Gets Cached:**
- Electron binaries (~100-200MB)
- Build tools (if used during first build)
- Code signing tools (if used)

#### Quick Transfer Checklist

- [ ] Run `npm install` and `npm run build:dir` on PC with internet
- [ ] Copy entire project folder (with `node_modules/`) to offline PC
- [ ] Copy `electron-builder/Cache` folder to same location on offline PC
- [ ] Verify cache exists on offline PC using `npm run prepare-offline`
- [ ] Verify `node_modules/electron/dist` exists on offline PC
- [ ] Run `npm run build:dir` on offline PC (should work without internet)

#### Troubleshooting Offline Builds

**If build still tries to download from GitHub:**

1. **Verify Electron is installed:**
   ```bash
   # Check if Electron exists in node_modules
   dir node_modules\electron\dist    # Windows
   ls node_modules/electron/dist     # macOS/Linux
   ```

2. **Verify cache location:**
   ```bash
   npm run prepare-offline
   ```
   This will show the exact cache path and verify it exists.

3. **Check cache structure:**
   The cache should contain:
   ```
   Cache/
   └── electron/
       └── 31.7.7/
           └── electron-v31.7.7-win32-x64.zip
   ```

4. **Force rebuild:**
   If cache exists but build still fails, try:
   ```bash
   # Clear electron-builder temp files
   rmdir /s /q %LOCALAPPDATA%\electron-builder\Cache\tmp    # Windows
   rm -rf ~/Library/Caches/electron-builder/Cache/tmp     # macOS
   rm -rf ~/.cache/electron-builder/Cache/tmp              # Linux
   
   # Then rebuild
   npm run build:dir
   ```

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


