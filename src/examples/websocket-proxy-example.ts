import { Container } from '../lib/container';
import type { ContainerState } from '../types';

/**
 * Example implementation of a Container with WebSocket proxying
 * Supports both HTTP and WebSocket traffic to the container
 */
export class WebSocketProxyContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Set how long the container should stay active without activity
  sleepAfter = "15m";

  // Track WebSocket message statistics
  initialState = {
    startedAt: Date.now(),
    wsConnections: 0,
    wsMessages: 0,
    httpRequests: 0
  };

  constructor(ctx: any, env: any) {
    super(ctx, env, {
      // Container environment variables
      env: {
        NODE_ENV: "production",
        ENABLE_WEBSOCKETS: "true"
      },
      // Start a Node.js WebSocket server in the container
      entrypoint: ["node", "server.js"],
      enableInternet: true
    });
  }

  // Lifecycle methods
  override onBoot(state?: ContainerState): void {
    console.log('Container booted with WebSocket support');
  }

  override onShutdown(state?: ContainerState): void {
    console.log('Container shutdown with stats:', state);
  }

  override onError(error: unknown): any {
    console.error('Container error:', error);
    throw error;
  }

  /**
   * Custom fetch implementation to handle both HTTP and WebSocket requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const currentState = this.state;
    
    // Check if this is a WebSocket upgrade request
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      // Update connection stats
      this.setState({
        ...currentState,
        wsConnections: (currentState.wsConnections as number || 0) + 1
      });
      
      // Proxy WebSocket to the container
      // This automatically renews the activity timeout on each message
      return this.proxyWebSocket(request, this.defaultPort);
    }
    
    // Handle special endpoint to check stats
    if (url.pathname === '/stats') {
      return new Response(JSON.stringify(this.state, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Track HTTP request count
    this.setState({
      ...currentState,
      httpRequests: (currentState.httpRequests as number || 0) + 1
    });
    
    // For regular HTTP requests, use standard proxying
    return await this.proxyRequest(request, this.defaultPort);
  }
}