/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * LISA Master Control Connector for Foundry VTT
 *
 * SECURITY: Server-side proxy architecture
 * - Connects through local Foundry server endpoint
 * - No direct IP exposure to VQ infrastructure
 * - All sensitive connections handled server-side
 */

if (typeof DualVQConnector === 'undefined') {
  class DualVQConnector {
    constructor() {
        this.lisa = null;
        this.vqBridge = null;
        this.stats = {
            lisaConnected: false,
            bridgeConnected: false,
            messagesProcessed: 0,
            componentsAvailable: 0,
            securityStatus: 'unknown',
            startTime: Date.now()
        };
    }

    buildSecureEndpoint() {
        // SECURITY: Connect only to local Foundry server proxy
        // Server handles all VQ/LISA connections internally
        const loc = window?.location;
        const protocol = loc?.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = loc?.host || 'localhost:30000';
        
        // Local proxy endpoint - no external IPs exposed
        return `${protocol}//${host}/vq-lisa-proxy`;
    }

    async connectLISA() {
        console.log('%c[LISA Connector] Connecting to LISA Master Control...', 'color: #00ff88;');
        const endpoint = this.buildSecureEndpoint();

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(endpoint);
            let connectionTimeout = setTimeout(() => {
                ws.close();
                reject(new Error('LISA connection timeout'));
            }, 10000);

            ws.onopen = () => {
                clearTimeout(connectionTimeout);
                this.stats.lisaConnected = true;
                console.log('%c[LISA Connector] Connected to LISA via secure proxy', 'color: #00ff88; font-weight: bold;');
                // Request cluster status
                ws.send(JSON.stringify({ 
                    type: 'lisa.status',
                    requestId: Date.now()
                }));

                this.lisa = {
                    version: '3.0.0',
                    system: 'RNK Vortex Quantum',
                    lisaControl: true,
                    ws,
                    
                    // LISA command interface
                    executeCommand: (component, command, params = {}) => {
                        this.stats.messagesProcessed++;
                        ws.send(JSON.stringify({
                            type: 'lisa.command',
                            component,
                            command,
                            params,
                            requestId: Date.now()
                        }));
                    },
                    
                    // Get component status
                    getComponentStatus: (componentType) => {
                        ws.send(JSON.stringify({
                            type: 'lisa.component.status',
                            componentType,
                            requestId: Date.now()
                        }));
                    },
                    
                    // Security system control
                    getSecurityStatus: () => {
                        ws.send(JSON.stringify({
                            type: 'lisa.security.status',
                            requestId: Date.now()
                        }));
                    },
                    
                    // Bridge status
                    getBridgeStatus: () => {
                        ws.send(JSON.stringify({
                            type: 'lisa.bridge.status',
                            requestId: Date.now()
                        }));
                    }
                };

                window.vortexQuantum = this.lisa;
                window.LISA = this.lisa;
                resolve(this.lisa);
            };

            ws.onerror = (error) => {
                clearTimeout(connectionTimeout);
                this.stats.lisaConnected = false;
                console.warn('[LISA Connector] Connection failed', error);
                reject(error);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('[LISA Message]', data.type);
                    
                    // Handle LISA status updates
                    if (data.type === 'lisa.status') {
                        this.stats.componentsAvailable = data.totalComponents || 0;
                        this.stats.securityStatus = data.securityStatus || 'unknown';
                        const cluster = data.cluster;
                        if (cluster) {
                            console.log(`%c[LISA] Tandem cluster mode=${cluster.mode} units=${cluster.unitsHealthy}/${cluster.unitsTotal}`, 'color: #00ff88;');
                        } else {
                            console.log(`%c[LISA] ${data.totalComponents} components available`, 'color: #00ff88;');
                        }
                    }
                    
                    // Broadcast to listeners
                    if (window.lisaMessageHandlers) {
                        window.lisaMessageHandlers.forEach(handler => handler(data));
                    }
                } catch (e) {
                    console.error('[LISA] Parse error:', e);
                }
            };
        });
    }

    async connectBridge() {
        console.log('%c[LISA Connector] Connecting to VQ Bridge...', 'color: #ff00ff;');
        
        // Bridge connection handled through same secure proxy
        // No separate connection needed - LISA manages bridge
        return new Promise((resolve) => {
            this.vqBridge = {
                version: '3.0.0',
                system: 'VortexQuantum Bridge',
                managed: true,
                
                // Bridge statistics
                getStats: () => {
                    if (this.lisa && this.lisa.ws) {
                        this.lisa.ws.send(JSON.stringify({
                            type: 'bridge.stats',
                            requestId: Date.now()
                        }));
                    }
                }
            };
            
            this.stats.bridgeConnected = true;
            window.vortexQuantumBridge = this.vqBridge;
            resolve(this.vqBridge);
        });
    }

    async initialize() {
        console.log('%c═══════════════════════════════════', 'color: #00ffff; font-size: 14px;');
        console.log('%c   LISA MASTER CONTROL CONNECTOR', 'color: #00ffff; font-size: 14px; font-weight: bold;');
        console.log('%c   Secure Proxy Architecture', 'color: #00ffff; font-size: 12px;');
        console.log('%c═══════════════════════════════════', 'color: #00ffff; font-size: 14px;');
        
        try {
            // Connect to LISA through secure proxy
            const lisaPromise = this.connectLISA();
            const bridgePromise = this.connectBridge();
            
            const timeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Connection timeout')), 5000)
            );
            
            await Promise.race([
                Promise.all([lisaPromise, bridgePromise]),
                timeout
            ]);
            
            console.log('%c', 'color: #00ff00; font-size: 16px;');
            console.log('%c[DUAL-VQ] CLUSTER ONLINE', 'color: #00ff00; font-size: 16px; font-weight: bold;');
            console.log('%c   Connected to VQ tandem cluster via secure proxy', 'color: #00ff00;');
            console.log('%c', 'color: #00ff00;');
            
            // Expose connector globally
            window.dualVQConnector = this;
            
            return true;
        } catch (error) {
            this.stats.lisaConnected = false;
            console.warn('%c[Dual-VQ] VQ servers unavailable - continuing without VQ features', 'color: #ffaa00; font-weight: bold;');
            console.warn('%c   To enable VQ features, start the LISA secure proxy on the Foundry server', 'color: #ffaa00;');
            console.warn('%c   Error: ' + error.message, 'color: #ffaa00;');
            
            // Create dummy VQ objects to prevent errors
            window.vortexQuantum = { 
                version: '3.0.0',
                system: 'RNK Vortex Quantum',
                bridge: false,
                offline: true,
                logSecurityEvent: () => {},
                send: () => {}
            };
            window.vortexQuantum2 = { ...window.vortexQuantum };
            window.dualVQConnector = this;
            
            return false; // VQ unavailable but not critical
        }
    }

    getStats() {
        const uptime = ((Date.now() - this.stats.startTime) / 1000 / 60).toFixed(1);
        return {
            status: {
                lisa: this.stats.lisaConnected ? '[ONLINE]' : '[OFFLINE]',
                bridge: this.stats.bridgeConnected ? '[ACTIVE]' : '[INACTIVE]',
                security: this.stats.securityStatus.toUpperCase(),
                system: (this.stats.lisaConnected && this.stats.bridgeConnected) ? 'OPERATIONAL' : 'DEGRADED'
            },
            components: {
                available: this.stats.componentsAvailable,
                engines: Math.floor(this.stats.componentsAvailable * 0.214),
                turbos: Math.floor(this.stats.componentsAvailable * 0.100),
                libraries: Math.floor(this.stats.componentsAvailable * 0.685)
            },
            traffic: {
                messagesProcessed: this.stats.messagesProcessed,
                averagePerMinute: (this.stats.messagesProcessed / (parseFloat(uptime) || 1)).toFixed(1)
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
      if (!window.dualVQConnector) {
        console.log('%c[Dual-VQ] Initializing in Foundry...', 'color: #ffff00;');
        window.dualVQConnector = new DualVQConnector();
        await window.dualVQConnector.initialize();
      } else {
        console.log('%c[Dual-VQ] Already initialized, skipping duplicate load', 'color: #888;');
      }
    });
  } else {
    // Standalone browser context
    console.log(
      '%c[Dual-VQ] Ready to initialize. Call: new DualVQConnector().initialize()',
      'color: #ffff00;'
    );

    window.DualVQConnector = DualVQConnector;
  }
} else {
  console.log('%c[Dual-VQ] DualVQConnector already defined, skipping redeclaration', 'color: #888;');
}
