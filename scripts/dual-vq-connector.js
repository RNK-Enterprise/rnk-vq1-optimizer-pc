/**
 * Dual-VQ WebSocket Client Integration
 * Connects Foundry to BOTH VQ instances and exposes them properly
 * Place this in your Foundry world scripts or load it before modules
 */

class DualVQConnector {
    constructor() {
        this.vq1 = null;
        this.vq2 = null;
        this.stats = {
            vq1Connected: false,
            vq2Connected: false,
            vq1Messages: 0,
            vq2Messages: 0,
            startTime: Date.now()
        };
    }

    async connectVQ1(port = 8765) {
        console.log('%c[Dual-VQ] Connecting to VQ Instance 1...', 'color: #00ff88;');
        
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://193.122.152.69:${port}`);
            
            ws.onopen = () => {
                console.log('%c[Dual-VQ] ✓ VQ1 Connected!', 'color: #00ff88; font-weight: bold;');
                this.stats.vq1Connected = true;
                
                // Create VQ1 instance object
                this.vq1 = {
                    version: '3.0.0',
                    system: 'RNK Vortex Quantum',
                    bridge: true,
                    ws: ws,
                    port: port,
                    logSecurityEvent: (event) => {
                        this.stats.vq1Messages++;
                        ws.send(JSON.stringify({ type: 'security-event', data: event }));
                    },
                    send: (data) => {
                        this.stats.vq1Messages++;
                        ws.send(JSON.stringify(data));
                    }
                };
                
                // Expose globally
                window.vortexQuantum = this.vq1;
                resolve(this.vq1);
            };
            
            ws.onerror = (error) => {
                console.error('%c[Dual-VQ] VQ1 Connection Error:', 'color: #ff0044;', error);
                reject(error);
            };
            
            ws.onmessage = (event) => {
                console.log('[VQ1 Message]', event.data);
            };
        });
    }

    async connectVQ2(port = 8766) {
        console.log('%c[Dual-VQ] Connecting to VQ Instance 2...', 'color: #ff00ff;');
        
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://193.122.152.69:${port}`);
            
            ws.onopen = () => {
                console.log('%c[Dual-VQ] ✓ VQ2 Connected!', 'color: #ff00ff; font-weight: bold;');
                this.stats.vq2Connected = true;
                
                // Create VQ2 instance object
                this.vq2 = {
                    version: '3.0.0',
                    system: 'RNK Vortex Quantum',
                    bridge: true,
                    ws: ws,
                    port: port,
                    logSecurityEvent: (event) => {
                        this.stats.vq2Messages++;
                        ws.send(JSON.stringify({ type: 'security-event', data: event }));
                    },
                    send: (data) => {
                        this.stats.vq2Messages++;
                        ws.send(JSON.stringify(data));
                    }
                };
                
                // Expose globally
                window.vortexQuantum2 = this.vq2;
                resolve(this.vq2);
            };
            
            ws.onerror = (error) => {
                console.error('%c[Dual-VQ] VQ2 Connection Error:', 'color: #ff0044;', error);
                reject(error);
            };
            
            ws.onmessage = (event) => {
                console.log('[VQ2 Message]', event.data);
            };
        });
    }

    async initialize() {
        console.log('%c═══════════════════════════════════', 'color: #00ffff; font-size: 14px;');
        console.log('%c   DUAL-VQ CONNECTOR STARTING', 'color: #00ffff; font-size: 14px; font-weight: bold;');
        console.log('%c═══════════════════════════════════', 'color: #00ffff; font-size: 14px;');
        
        try {
            // Connect to both VQ instances
            await this.connectVQ1(8765);
            await this.connectVQ2(8766);
            
            console.log('%c', 'color: #00ff00; font-size: 16px;');
            console.log('%c🚀 DUAL-VQ CLUSTER ONLINE!', 'color: #00ff00; font-size: 16px; font-weight: bold;');
            console.log('%c   Both instances connected and ready', 'color: #00ff00;');
            console.log('%c', 'color: #00ff00;');
            
            // Expose connector globally
            window.dualVQConnector = this;
            
            return true;
        } catch (error) {
            console.error('%c[Dual-VQ] Initialization failed:', 'color: #ff0044; font-weight: bold;', error);
            return false;
        }
    }

    getStats() {
        const uptime = ((Date.now() - this.stats.startTime) / 1000 / 60).toFixed(1);
        return {
            status: {
                vq1: this.stats.vq1Connected ? '✓ ONLINE' : '✗ OFFLINE',
                vq2: this.stats.vq2Connected ? '✓ ONLINE' : '✗ OFFLINE',
                cluster: (this.stats.vq1Connected && this.stats.vq2Connected) ? 'ACTIVE' : 'PARTIAL'
            },
            traffic: {
                vq1Messages: this.stats.vq1Messages,
                vq2Messages: this.stats.vq2Messages,
                totalMessages: this.stats.vq1Messages + this.stats.vq2Messages
            },
            uptime: `${uptime} minutes`,
            timestamp: new Date().toISOString()
        };
    }
}

// Auto-initialize when loaded
if (typeof Hooks !== 'undefined') {
  // Foundry VTT context
  Hooks.once('init', async () => {
    console.log('%c[Dual-VQ] Initializing in Foundry...', 'color: #ffff00;');
    window.dualVQConnector = new DualVQConnector();
    await window.dualVQConnector.initialize();
  });
} else {
  // Standalone browser context
  console.log(
    '%c[Dual-VQ] Ready to initialize. Call: new DualVQConnector().initialize()',
    'color: #ffff00;'
  );

  window.DualVQConnector = DualVQConnector;
}
