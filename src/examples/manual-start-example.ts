import { Container } from '../lib/container';
import type { ContainerState } from '../types';

/**
 * Example implementation of a Container with manual container start
 */
export class ManualStartContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Set how long the container should stay active without requests
  sleepAfter = "15m";

  constructor(ctx: any, env: any) {
    // Use explicitContainerStart option to prevent automatic container startup
    super(ctx, env, {
      explicitContainerStart: true
    });
  }

  // Lifecycle method called when container boots
  override onBoot(state?: ContainerState): void {
    console.log('Container booted!', state);
  }

  // Lifecycle method called when container shuts down
  override onShutdown(state?: ContainerState): void {
    console.log('Container shutdown!', state);
  }

  // Lifecycle method called on errors
  override onError(error: unknown): any {
    console.error('Container error:', error);
    throw error;
  }

  /**
   * Handle incoming requests - start the container on demand
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Start the container if it's not already running
    if (!this.ctx.container?.running) {
      try {
        await this.startAndWaitForPort(this.defaultPort);

        // You could return a different response for the first request
        if (url.pathname === '/start') {
          return new Response('Container started successfully!', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
      } catch (error) {
        return new Response(`Failed to start container: ${error instanceof Error ? error.message : String(error)}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    }

    // Check if this is a WebSocket upgrade request
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      // For WebSocket requests, we need to proxy it to the container
      // PartyKit has special handling for WebSockets, but for our container
      // example we'll just return a standard response
      return new Response('WebSocket connections should be proxied to container', {
        status: 101,
        headers: {
          'Connection': 'upgrade',
          'Upgrade': 'websocket'
        }
      });
    }

    // For standard HTTP requests, proxy to the container
    return await this.proxyRequest(request);
  }

  // Additional methods can be implemented as needed
}