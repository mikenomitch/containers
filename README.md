# Containers

A class for interacting with Containers on Cloudflare Workers.

## Features

- Simplified container lifecycle management
- Automatic port detection and waiting
- HTTP request proxying and WebSocket forwarding
- Automatic container sleep timeout with activity-based renewal
- Load balancing utilities
- Event hooks for container lifecycle events

## Installation

```bash
npm install cf-containers-nomitch
```

## Basic Example

```typescript
import { Container, loadBalance } from 'cf-containers-nomitch';

export class MyContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;

    // If you wish to route requests to a specific container,
    // pass a container identifier to .get()

    if (pathname.startsWith("/specific/")) {
      // In this case, each unique pathname will spawn a new container
      let id = env.MY_CONTAINER.idFromName(pathname);
      let stub = env.MY_CONTAINER.get(id);
      return await stub.fetch(request);
    }

    // Otherwise, fall back to one of 5 containers
    let container = await loadBalance(env.MY_CONTAINER, 5); // 5 is instance count
    return await container.fetch(request);
  },
};
```

## API Reference

### Container Class

The main class that wraps a container-enbled Durable Object to provide container functionality.

#### Properties

- `defaultPort?`: Optional default port to use when communicating with the container. If not set, you must specify port in containerFetch calls
- `requiredPorts?`: Array of ports that should be checked for availability during container startup. Used by startAndWaitForPorts when no specific ports are provided.
- `sleepAfter`: How long to keep the container alive without activity (format: number for seconds, or string like "5m", "30s", "1h")
- `explicitContainerStart`: If true, container won't start automatically on DO boot (default: false). Set as a class property or via constructor options.
- `containerConfig`: Configuration for the container's environment, entrypoint, and network access
- Lifecycle methods: `onBoot`, `onShutdown`, `onError`

#### Constructor Options

```typescript
constructor(ctx: any, env: Env, options?: {
  defaultPort?: number;           // Override default port
  sleepAfter?: string | number;   // Override sleep timeout
  explicitContainerStart?: boolean; // Disable automatic container start (prefer setting as class property)
  env?: Record<string, string>;   // Environment variables to pass to the container
  entrypoint?: string[];          // Custom entrypoint to override container default
  enableInternet?: boolean;       // Whether to enable internet access for the container
})
```

#### Methods

##### Lifecycle Methods
- `onBoot()`: Called when container boots successfully - override to add custom behavior
- `onShutdown()`: Called when container shuts down - override to add custom behavior
- `onError(error)`: Called when container encounters an error - override to add custom behavior

##### Container Methods
- `startContainer()`: Starts the container if it's not running and sets up monitoring, without waiting for any ports to be ready.
- `startAndWaitForPorts(ports?, maxTries?)`: Starts the container using startContainer and then waits for specified ports to be ready. If no ports are specified, uses `requiredPorts` or `defaultPort`. If no ports can be determined, just starts the container without port checks.
- `startAndWaitForPort(port?, maxTries?)`: (Deprecated) Backwards compatibility method that calls startAndWaitForPorts.
- `containerFetch(request, port?)`: Sends an HTTP or WebSocket request to the container. Either port parameter or defaultPort must be specified. Automatically detects WebSocket upgrade requests.
- `shutdownContainer(reason?)`: Stops the container
- `fetch(request)`: Default handler to forward HTTP requests to the container
- `renewActivityTimeout()`: Manually renews the container activity timeout (extends container lifetime)
- `shutdownDueToInactivity()`: Called automatically when the container times out due to inactivity

### Utility Functions

- `loadBalance(binding, instances?)`: Load balances requests across multiple container instances
- `randomContainerId(max)`: Generates a random container ID for load balancing


## Examples

### Basic HTTP Example

```typescript
import { Container } from 'cf-containers-nomitch';

export class MyContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Set how long the container should stay active without requests
  // Supported formats: "10m" (minutes), "30s" (seconds), "1h" (hours), or a number (seconds)
  sleepAfter = "10m";


  // Lifecycle method called when container boots
  override onBoot(): void {
    console.log('Container booted!');
  }

  // Lifecycle method called when container shuts down
  override onShutdown(): void {
    console.log('Container shutdown!');
  }


  // Lifecycle method called on errors
  override onError(error: unknown): any {
    console.error('Container error:', error);
    throw error;
  }

  // Custom method that will extend the container's lifetime
  async performBackgroundTask(): Promise<void> {
    // Do some work...

    // Renew the container's activity timeout
    await this.renewActivityTimeout();
    console.log('Container activity timeout extended');
  }

  // Handle incoming requests
  async fetch(request: Request): Promise<Response> {
  
    // Default implementation forwards requests to the container
    // This will automatically renew the activity timeout
    return await this.containerFetch(request);
  }

  // Additional methods can be implemented as needed
}
```

### WebSocket Support

The Container class automatically supports proxying WebSocket connections to your container. WebSocket connections are bi-directionally proxied, with messages forwarded in both directions. The Container also automatically renews the activity timeout when WebSocket messages are sent or received.

#### WebSocket Example

Here's an example of a Container class that supports both HTTP and WebSocket proxying:

```typescript
import { Container } from 'cf-containers-nomitch';

export class WebSocketProxyContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;


  constructor(ctx: any, env: any) {
    super(ctx, env);
  }

  /**
   * Handle incoming HTTP/WebSocket requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Check if this is a WebSocket upgrade request
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {

      // containerFetch automatically detects and handles WebSocket connections
      // it sets up bi-directional message forwarding
      return this.containerFetch(request, this.defaultPort);
    }

    // For regular HTTP requests, fetch as usual
    return await this.containerFetch(request);
  }
}
```

#### Direct WebSocket Connections

You can call the `containerFetch` method directly to establish WebSocket connections:

```typescript
// Connect to a WebSocket on port 9000
const response = await container.containerFetch(request, 9000);
```

The containerFetch method will automatically detect WebSocket upgrade requests based on the 'Upgrade: websocket' header.

### Container Configuration Example

You can configure how the container starts using the `containerConfig` property:

```typescript
import { Container } from 'cf-containers-nomitch';

export class ConfiguredContainer extends Container {
  // Default port for the container
  defaultPort = 9000;

  // Override the default container configuration
  containerConfig = {
    // Environment variables to pass to the container
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      APP_PORT: '9000'
    },

    // Custom entrypoint to run in the container
    entrypoint: ['node', 'server.js', '--config', 'production.json'],

    // Enable internet access for the container
    enableInternet: true
  };

  constructor(ctx: any, env: any) {
    super(ctx, env);
    // containerConfig will be used automatically when the container boots
  }
}
```

### Manual Container Start Example

For more control over container lifecycle, you can use the `explicitContainerStart` option to disable automatic container startup:

```typescript
import { Container } from 'cf-containers-nomitch';

export class ManualStartContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Specify multiple required ports that must be ready before the container is considered booted
  requiredPorts = [8080, 9090, 3000];

  // Disable automatic container startup (preferred way as a class property)
  explicitContainerStart = true;

  constructor(ctx: any, env: any) {
    // You can also set explicitContainerStart via constructor options
    // super(ctx, env, {
    //   explicitContainerStart: true
    // });
    super(ctx, env);
  }

  /**
   * Handle incoming requests - start the container on demand
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Start the container if it's not already running
    if (!this.ctx.container.running) {
      try {
        // Handle different startup paths
        if (url.pathname === '/start') {
          // Just start the container without waiting for any ports
          await this.startContainer();
          return new Response('Container started but ports not yet verified!');
        }
        else if (url.pathname === '/start-api') {
          // Only wait for the API port (3000)
          await this.startAndWaitForPorts(3000);
          return new Response('API port is ready!');
        }
        else if (url.pathname === '/start-all') {
          // Wait for all required ports (uses requiredPorts property)
          await this.startAndWaitForPorts();
          return new Response('All container ports are ready!');
        }
        else {
          // For other paths, just wait for the default port
          await this.startAndWaitForPorts(this.defaultPort);
        }
      } catch (error) {
        return new Response(`Failed to start container: ${error}`, { status: 500 });
      }
    }

    // For all other requests, forward to the container
    return await this.containerFetch(request);
  }
}
```

### Multiple Required Ports Example

This example demonstrates how to use the `requiredPorts` property to ensure that multiple services inside your container are ready before the container is considered booted:

```typescript
import { Container } from 'cf-containers-nomitch';

export class MultiPortContainer extends Container {
  // Default port for the public website
  defaultPort = 80;

  // List all ports that should be verified during container startup
  requiredPorts = [
    80,   // Public website
    3000, // API server
    9090  // Metrics endpoint
  ];

  // Startup timeout in seconds (default is 10 retries with 300ms between each)
  startTimeout = 30;

  constructor(ctx: any, env: any) {
    super(ctx, env);
  }

  // Custom port verification for a more complex container
  async verifyContainer(): Promise<void> {
    // Use startAndWaitForPorts without arguments to check all requiredPorts
    await this.startAndWaitForPorts(undefined, this.startTimeout);
    console.log('All container services are ready!');
  }

  // Enhanced boot handler with extra verification
  override async onBoot() {
    console.log('Container passed basic port checks, verifying services...');

    // Perform additional service health checks if needed
    const apiHealth = await this.containerFetch(
      new Request('http://healthcheck/api/health'),
      3000
    );

    console.log('API health check status:', apiHealth.status);

  }

  async fetch(request: Request): Promise<Response> {
    // Route traffic based on URL path
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api')) {
        // API server runs on port 3000
        return await this.containerFetch(request, 3000);
      }
      else if (url.pathname.startsWith('/metrics')) {
        // Metrics endpoint on port 9090
        return await this.containerFetch(request, 9090);
      }
      else {
        // Public website on port 80 (defaultPort)
        return await this.containerFetch(request, 80);
      }
    } catch (error) {
      return new Response(`Error: ${error instanceof Error ? error.message : String(error)}`, {
        status: 500
      });
    }
  }
}
```

### Multiple Ports and Custom Routing

You can also create a container that doesn't use a default port and instead routes traffic to different ports based on request path or other factors:

```typescript
import { Container } from 'cf-containers-nomitch';

export class MultiPortContainer extends Container {
  // No defaultPort defined - we'll handle port specification manually

  constructor(ctx: any, env: any) {
    super(ctx, env);
  }

  /**
   * Process an incoming request and route to different ports based on path
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api')) {
        // API server runs on port 3000
        return await this.containerFetch(request, 3000);
      }
      else if (url.pathname.startsWith('/admin')) {
        // Admin interface runs on port 8080
        return await this.containerFetch(request, 8080);
      }
      else {
        // Public website runs on port 80
        return await this.containerFetch(request, 80);
      }
    } catch (error) {
      return new Response(`Error: ${error instanceof Error ? error.message : String(error)}`, {
        status: 500
      });
    }
  }
}
```

### Managing Container Idle Timeout

The Container class includes an automatic idle timeout feature that will shut down the container after a period of inactivity. This helps save resources when containers are not in use.

```typescript
import { Container } from 'cf-containers-nomitch';

export class TimeoutContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Set timeout to 30 minutes of inactivity
  sleepAfter = "30m";  // Supports "30s", "5m", "1h" formats, or a number in seconds


  // Custom method that will extend the container's lifetime
  async performBackgroundTask(data: any): Promise<void> {
    console.log('Performing background task with data:', data);


    // Manually renew the activity timeout
    await this.renewActivityTimeout();

    console.log('Container activity timeout renewed');
  }

  // Activity timeout is automatically renewed on fetch requests
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Example endpoint to trigger background task
    if (url.pathname === '/task') {
      const taskData = { id: Date.now().toString() };
      await this.performBackgroundTask(taskData);

      return new Response(JSON.stringify({
        success: true,
        message: 'Background task executed',
        nextShutdown: `Container will shut down after ${this.sleepAfter} of inactivity`
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // For all other requests, forward to the container
    // This will automatically renew the activity timeout
    return await this.containerFetch(request);
  }
}
```

### Using Load Balancing

```typescript
import { Container, loadBalance } from 'cf-containers-nomitch';

export class MyContainer extends Container {
  defaultPort = 8080;
}

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);

    // Example: Load balance across 5 container instances
    if (url.pathname === '/api') {
      const container = await loadBalance(env.MY_CONTAINER, 5);
      return await container.fetch(request);
    }

    // Example: Direct request to a specific container
    if (url.pathname.startsWith('/specific/')) {
      const id = url.pathname.split('/')[2] || 'default';
      const objectId = env.MY_CONTAINER.idFromName(id);
      const container = env.MY_CONTAINER.get(objectId);
      return await container.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
```
