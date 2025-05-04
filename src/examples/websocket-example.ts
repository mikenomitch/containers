import { Container } from '../lib/container';
import type { Connection, ConnectionContext } from 'partyserver';

/**
 * Example implementation of a Container class with WebSocket support via custom endpoint
 *
 * IMPORTANT: This approach requires that a WebSocket server is running in the container
 * and that the Container class has direct access to the client-side WebSocket.
 * PartyKit WebSocket API is not used - this is for standalone use.
 */
export class WebSocketContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Set how long the container should stay active without requests
  sleepAfter = "15m";

  constructor(ctx: any, env: any) {
    super(ctx, env);
  }

  // Lifecycle method called when container starts
  override onStart(): void {
    console.log('Container started for WebSocket connections');
  }

  // Lifecycle method called when container shuts down
  override onStop(): void {
    console.log('Container stopped');
  }

  // Lifecycle method called on errors
  override onError(error: unknown): any {
    console.error('Container error:', error);
    throw error;
  }

  /**
   * Handle incoming HTTP requests
   * This example shows how to handle WebSocket creation in your application code
   * rather than using PartyKit WebSocket handling.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Special endpoint that provides WebSocket connection info
    if (url.pathname === '/websocket-info') {
      // Ensure container is running
      if (!this.ctx.container?.running) {
        try {
          await this.startAndWaitForPorts();
        } catch (e) {
          return new Response('Container failed to start', { status: 500 });
        }
      }

      // Return WebSocket endpoint info
      const containerPort = this.defaultPort;
      return new Response(JSON.stringify({
        status: 'ok',
        websocketUrl: `ws://container:${containerPort}/ws`,
        info: 'Connect to this WebSocket URL via your client code'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // For all other requests, proxy to the container
    return await this.containerFetch(request);
  }

  // Additional helper methods can be implemented as needed
}