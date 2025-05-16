import { Container } from '../lib/container';

/**
 * Example implementation showing container configuration options
 */
export class ConfiguredContainer extends Container {
  // Default port for the container
  defaultPort = 9000;

  // Environment variables to pass to the container
  envVars = {
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
    APP_PORT: '9000',
    API_URL: 'https://api.example.com'
  };

  // Custom entrypoint to run in the container
  entrypoint = ['node', 'server.js', '--config', 'production.json'];

  // Enable internet access for the container
  enableInternet = true;

  constructor(ctx: any, env: any) {
    // Container configuration is set via instance properties
    super(ctx, env);

    // You can also modify config properties here if needed
    // this.envVars.ADDITIONAL_VAR = 'some value';
  }

  // Lifecycle method called when container starts
  override onStart(): void {
    const config = {
      env: this.envVars,
      entrypoint: this.entrypoint,
      enableInternet: this.enableInternet
    };
    console.log('Container started with config:', config);
  }

  // Override the fetch method to customize request handling
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Special endpoint to view current configuration
    if (url.pathname === '/config') {
      const config = {
        env: this.envVars,
        entrypoint: this.entrypoint,
        enableInternet: this.enableInternet
      };
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