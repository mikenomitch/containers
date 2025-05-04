import { Container } from '../lib/container';
import type { ContainerState } from '../types';

/**
 * Example implementation showing container configuration options
 */
export class ConfiguredContainer extends Container {
  // Default port for the container
  defaultPort = 9000;

  // Override the default container configuration
  containerConfig = {
    // Environment variables to pass to the container
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      APP_PORT: '9000',
      API_URL: 'https://api.example.com'
    },

    // Custom entrypoint to run in the container
    entrypoint: ['node', 'server.js', '--config', 'production.json'],

    // Enable internet access for the container
    enableInternet: true
  };

  // Sample initial state
  initialState = {
    startedAt: Date.now(),
    configVersion: 'v1.0'
  };

  constructor(ctx: any, env: any) {
    // You can also override or extend containerConfig values in the constructor
    super(ctx, env);

    // You can modify containerConfig after construction if needed
    // this.containerConfig.env.FEATURE_FLAGS = 'beta,analytics';
  }

  // Lifecycle method called when container boots
  override onBoot(state?: ContainerState): void {
    console.log('Container booted with config:', this.containerConfig);
  }

  // Override the fetch method to customize request handling
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Special endpoint to view current configuration
    if (url.pathname === '/config') {
      return new Response(JSON.stringify({
        port: this.defaultPort,
        config: this.containerConfig,
        state: this.state
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // For other requests, proxy to the container
    return await this.proxyRequest(request);
  }
}