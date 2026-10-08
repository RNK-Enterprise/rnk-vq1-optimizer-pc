# RNK Vortex GM Hub - LISA Integration Update

## SECURITY ARCHITECTURE

**CRITICAL**: This module now connects to LISA Master Control through a **secure proxy architecture** that protects your VQ infrastructure from exposure when releasing to the community.

### Architecture Overview

```
[Community Client] → [Foundry Server] → [Secure Proxy] → [LISA Master Control]
     (Browser)         (Your Machine)    (Your Machine)    (Your VQ Server)
```

**NO IP ADDRESSES ARE EXPOSED TO CLIENTS!**

## What Changed

### Before (Insecure):
- Clients connected directly to VQ ports 9876/9877
- IP addresses hardcoded or exposed in client code
- **NOT SAFE for community release**

### After (Secure):
- Clients connect to local Foundry WebSocket endpoint only
- Foundry server runs secure proxy (lisa-secure-proxy.js)
- Proxy handles all VQ/LISA connections internally
- **SAFE for community release** - zero IP exposure

## New Files

### 1. `scripts/dual-vq-connector.js` (UPDATED)
**Client-side connector** - safe for community distribution
- Connects to local proxy endpoint only (`/vq-lisa-proxy`)
- No hardcoded IPs or sensitive information
- LISA command interface for modules

### 2. `lisa-secure-proxy.js` (NEW - SERVER ONLY)
**Server-side proxy** - KEEP THIS PRIVATE
- Runs on your Foundry server
- Connects to LISA at your VQ server
- Handles all sensitive connections
- **DO NOT distribute this file to community**

## Deployment Instructions

### For Your Foundry Server (Private)

1. **Start LISA Secure Proxy** (on your Foundry machine):
```bash
# Set VQ connection details via environment variables
export VQ_LISA_HOST="193.122.152.69"
export VQ_LISA_PORT="3000"
export LISA_PROXY_PORT="9999"

# Start proxy
node lisa-secure-proxy.js
```

2. **Configure Foundry WebSocket Route**:
Add to your Foundry nginx/proxy config:
```nginx
location /vq-lisa-proxy {
    proxy_pass http://localhost:9999;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### For Community Distribution (Public)

**ONLY distribute these files:**
- `module.json`
- `scripts/dual-vq-connector.js` ✓ SAFE
- `scripts/rnk-vortex-gm-hub.js` ✓ SAFE
- `styles/*`
- `templates/*`
- `lang/*`

**NEVER distribute:**
- ❌ `lisa-secure-proxy.js` (server-side only)
- ❌ Any files with IP addresses or credentials
- ❌ VQ connection configuration

## Testing Locally

1. Start LISA Secure Proxy:
```bash
cd "RNK Vortex Quantum Modules/rnk-vortex-gm-hub"
node lisa-secure-proxy.js
```

2. Open Foundry VTT and enable the module

3. Check browser console for:
```
[LISA Connector] ✓ Connected to LISA via secure proxy
🚀 LISA MASTER CONTROL ONLINE!
   9,245 Components under LISA control
```

## LISA API for Modules

Your module now has access to LISA Master Control:

```javascript
// Check if LISA is available
if (window.LISA && !window.LISA.offline) {

    // Execute component command
    window.LISA.executeCommand('touch-engine', 'initialize', {
        sensitivity: 'high'
    });

    // Get component status
    window.LISA.getComponentStatus('engines');

    // Check security status
    window.LISA.getSecurityStatus();

    // Get bridge statistics
    window.LISA.getBridgeStatus();

    // Listen for LISA messages
    if (!window.lisaMessageHandlers) {
        window.lisaMessageHandlers = [];
    }
    window.lisaMessageHandlers.push((data) => {
        console.log('LISA Message:', data);
    });
}
```

## Security Checklist

Before releasing module to community:

- ✅ Remove all IP addresses from client code
- ✅ Remove all credentials/tokens
- ✅ Keep lisa-secure-proxy.js private
- ✅ Test that module works without VQ connection (offline mode)
- ✅ Verify no console errors expose sensitive info
- ✅ Check that module.json has no private URLs

## Production Deployment

### On Your VQ Server (193.122.152.69):
- ✅ LISA Master Control running (port 3000)
- ✅ VQ-PRIMARY running (port 3000)
- ✅ VQ-SECONDARY running (port 3001)
- ✅ Bridge running (port 3002)

### On Your Foundry Server:
- ✅ LISA Secure Proxy running (port 9999)
- ✅ WebSocket route configured
- ✅ Module installed in Foundry

### For Community Users:
- Module connects to YOUR Foundry server
- Foundry server connects to YOUR VQ infrastructure
- Community never sees your VQ server IPs
- **Your infrastructure remains private and secure**

## Status

**Version**: 2.0.0
**LISA Integration**: ✓ Complete
**Security**: ✓ Proxy Architecture Implemented
**Community Ready**: ✓ Safe for distribution (exclude proxy server)

---
**Copyright © 2026 Lisa's Dungeon. Licensed under the GNU General Public License v3; see [LICENSE](LICENSE) for the full text.**
