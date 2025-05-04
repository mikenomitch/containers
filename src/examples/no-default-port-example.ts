import { Container } from '../lib/container';
import type { ContainerState } from '../types';

/**
 * Example implementation of a Container without a default port,
 * demonstrating how to manually specify ports for proxying
 */
export class NoDefaultPortContainer extends Container {
  // No defaultPort defined - we'll handle port specification manually
  
  // Configure normal timeout
  sleepAfter = "10m";

  // Initial state
  initialState = {
    startedAt: Date.now(),
    paths: {}
  };

  constructor(ctx: any, env: any) {
    super(ctx, env);
  }

  /**
   * Process an incoming request and route to different ports based on path
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Track all paths accessed
    const currentState = this.state;
    const existingPaths = (currentState.paths || {}) as Record<string, number>;
    const paths = { ...existingPaths };
    paths[url.pathname] = (paths[url.pathname] || 0) + 1;
    
    this.setState({
      ...currentState,
      lastRequest: Date.now(),
      paths
    });
    
    // Different paths are handled by different services running on different ports
    try {
      if (url.pathname.startsWith('/api')) {
        // API server runs on port 3000
        return await this.proxyRequest(request, 3000);
      } 
      else if (url.pathname.startsWith('/admin')) {
        // Admin interface runs on port 8080
        return await this.proxyRequest(request, 8080);
      }
      else if (url.pathname.startsWith('/metrics')) {
        // Prometheus metrics exposed on port 9090
        return await this.proxyRequest(request, 9090);
      }
      else {
        // Public website runs on port 80
        return await this.proxyRequest(request, 80);
      }
    } catch (error) {
      return new Response(`Error processing request: ${error instanceof Error ? error.message : String(error)}`, {
        status: 500
      });
    }
  }

  // Lifecycle methods
  override onBoot(state?: ContainerState): void {
    console.log('Container started without checking any default port');
  }

  override onShutdown(state?: ContainerState): void {
    console.log('Container shutdown');
  }
}