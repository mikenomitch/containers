import { Container } from '../lib/container';

/**
 * Example implementation showing container configuration options
 */
export class ConfiguredContainer extends Container {
  // Default port for the container
  defaultPort = 9000;

  // Override the default container configuration at class level
  static override containerConfig = {
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

  constructor(ctx: any, env: any) {
    // Container configuration should be set at class level using static containerConfig
    super(ctx, env);
    
    // No longer supports modifying containerConfig at instance level
  }

  // Lifecycle method called when container boots
  override onBoot(): void {
    const config = (this.constructor as typeof Container).containerConfig;
    console.log('Container booted with config:', config);
  }

  // Override the fetch method to customize request handling
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Special endpoint to view current configuration
    if (url.pathname === '/config') {
      const config = (this.constructor as typeof Container).containerConfig;
      return new Response(JSON.stringify({
        port: this.defaultPort,
        config: config
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // For other requests, proxy to the container
    return await this.containerFetch(request);
  }
}