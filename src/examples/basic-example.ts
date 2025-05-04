import { Container } from '../lib/container';
import type { ContainerState } from '../types';

/**
 * Example implementation of a Container class
 */
export class MyContainer extends Container {
  // Configure default port for the container - required for automatic proxying
  defaultPort = 8080;

  // Set how long the container should stay active without requests
  sleepAfter = "10m";

  // Optionally define initial state
  initialState = {
    startedAt: Date.now(),
    requestCount: 0
  };

  constructor(ctx: any, env: any) {
    super(ctx, env, {
      // Container configuration - these are the same settings used when calling this.ctx.container.start()
      env: {
        NODE_ENV: "production",
        LOG_LEVEL: "info"
      },
      entrypoint: ["node", "server.js"],
      enableInternet: true
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

  // Lifecycle method called when state is updated
  override onStateUpdate(state: ContainerState): void {
    console.log('State updated:', state);
  }

  // Lifecycle method called on errors
  override onError(error: unknown): any {
    console.error('Container error:', error);
    throw error;
  }

  // Handle incoming requests
  async fetch(request: Request): Promise<Response> {
    // Update state to track requests
    const currentState = this.state;
    this.setState({
      ...currentState,
      requestCount: (currentState.requestCount as number || 0) + 1,
      lastRequestAt: Date.now()
    });

    // Default implementation proxies requests to the container
    return await this.proxyRequest(request);
  }

  // Additional custom methods can be implemented as needed
}