# Containers

A TypeScript helper class that wraps PartyKit durable objects and provides helper methods for interacting with containers, while hiding the durable object implementation details.

## Features

- Simplified container lifecycle management
- Automatic port detection and waiting
- HTTP request proxying and WebSocket forwarding
- State management
- Automatic container sleep timeout with activity-based renewal
- Load balancing utilities
- Event hooks for container lifecycle events

## Installation

```bash
npm install containers
```

## Usage

### Basic HTTP Example

```typescript
import { Container } from 'containers';
import type { ContainerState } from 'containers';

export class MyContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Set how long the container should stay active without requests
  // Supported formats: "10m" (minutes), "30s" (seconds), "1h" (hours), or a number (seconds)
  sleepAfter = "10m";

  // Optionally define initial state
  initialState = {
    startedAt: Date.now(),
    requestCount: 0
  };

  // Constructor with options
  constructor(ctx: any, env: any) {
    // Pass options to control container behavior
    super(ctx, env, {
      // If true, container won't start automatically - you must call startAndWaitForPort manually
      // explicitContainerStart: false, // Default is false - container starts automatically

      // Container configuration
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

  // Custom method that will extend the container's lifetime
  async performBackgroundTask(): Promise<void> {
    // Do some work...

    // Renew the container's activity timeout
    await this.renewActivityTimeout();
    console.log('Container activity timeout extended');
  }

  // Handle incoming requests
  async fetch(request: Request): Promise<Response> {
    // Update state to track requests
    const currentState = this.state;
    this.setState({
      ...currentState,
      requestCount: (currentState.requestCount as number || 0) + 1,
      lastActivity: Date.now()
    });

    // Default implementation proxies requests to the container
    // This will automatically renew the activity timeout
    return await this.proxyRequest(request);
  }

  // Additional methods can be implemented as needed
}
```

### WebSocket Support

The Container class automatically supports proxying WebSocket connections to your container. WebSocket connections are bi-directionally proxied, with messages forwarded in both directions. The Container also automatically renews the activity timeout when WebSocket messages are sent or received.

#### WebSocket Example

Here's an example of a Container class that supports both HTTP and WebSocket proxying:

```typescript
import { Container } from 'containers';
import type { ContainerState } from 'containers';

export class WebSocketProxyContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Track connection stats
  initialState = {
    startedAt: Date.now(),
    wsConnections: 0
  };

  constructor(ctx: any, env: any) {
    super(ctx, env);
  }

  /**
   * Handle incoming HTTP/WebSocket requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const currentState = this.state;

    // Check if this is a WebSocket upgrade request
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      // Track WebSocket connections
      this.setState({
        ...currentState,
        wsConnections: (currentState.wsConnections as number || 0) + 1
      });

      // proxyWebSocket automatically handles the WebSocket connection
      // it sets up bi-directional message forwarding
      return this.proxyWebSocket(request, this.defaultPort);
    }

    // For regular HTTP requests, proxy as usual
    return await this.proxyRequest(request);
  }
}
```

#### Direct WebSocket Proxying

You can call the `proxyWebSocket` method directly to proxy WebSocket connections:

```typescript
// Proxy a WebSocket connection to port 9000
const response = await container.proxyWebSocket(request, 9000);
```

The default fetch implementation will automatically detect WebSocket upgrade requests and call `proxyWebSocket` for you.

### Container Configuration Example

You can configure how the container starts using the `containerConfig` property:

```typescript
import { Container } from 'containers';

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
import { Container } from 'containers';

export class ManualStartContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  constructor(ctx: any, env: any) {
    // Disable automatic container startup
    super(ctx, env, {
      explicitContainerStart: true
    });
  }

  /**
   * Handle incoming requests - start the container on demand
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Start the container if it's not already running
    if (!this.ctx.container.running) {
      try {
        await this.startAndWaitForPort(this.defaultPort);

        // Special handling for startup requests
        if (url.pathname === '/start') {
          return new Response('Container started successfully!');
        }
      } catch (error) {
        return new Response(`Failed to start container: ${error}`, { status: 500 });
      }
    }

    // For all other requests, proxy to the container
    return await this.proxyRequest(request);
  }
}
```

### Multiple Ports and Routing

You can create a container that doesn't use a default port and instead routes traffic to different ports based on request path or other factors:

```typescript
import { Container } from 'containers';
import type { ContainerState } from 'containers';

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
        return await this.proxyRequest(request, 3000);
      }
      else if (url.pathname.startsWith('/admin')) {
        // Admin interface runs on port 8080
        return await this.proxyRequest(request, 8080);
      }
      else {
        // Public website runs on port 80
        return await this.proxyRequest(request, 80);
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
import { Container } from 'containers';
import type { ContainerState } from 'containers';

export class TimeoutContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Set timeout to 30 minutes of inactivity
  sleepAfter = "30m";  // Supports "30s", "5m", "1h" formats, or a number in seconds

  // Sample initial state with timestamp
  initialState = {
    startedAt: Date.now(),
    activityCount: 0
  };

  // Custom method that will extend the container's lifetime
  async performBackgroundTask(data: any): Promise<void> {
    console.log('Performing background task with data:', data);

    // Update the state to track activity
    const currentState = this.state;
    this.setState({
      ...currentState,
      activityCount: (currentState.activityCount as number || 0) + 1,
      lastActivity: {
        type: 'background',
        timestamp: Date.now(),
        data
      }
    });

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

    // For all other requests, proxy to the container
    // This will automatically renew the activity timeout
    return await this.proxyRequest(request);
  }
}
```

### Using Load Balancing

```typescript
import { Container, loadBalance } from 'containers';

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

## API Reference

### Container Class

The main class that wraps PartyKit's Server to provide container functionality.

#### Properties

- `defaultPort?`: Optional default port to use when communicating with the container. If not set, you must specify port in proxyRequest calls
- `sleepAfter`: How long to keep the container alive without activity (format: number for seconds, or string like "5m", "30s", "1h")
- `explicitContainerStart`: If true, container won't start automatically on DO boot (default: false)
- `containerConfig`: Configuration for the container's environment, entrypoint, and network access
- Lifecycle methods: `onBoot`, `onShutdown`, `onStateUpdate`, `onError`
- `initialState`: Initial state for the container

#### Constructor Options

```typescript
constructor(ctx: any, env: Env, options?: {
  defaultPort?: number;           // Override default port
  sleepAfter?: string | number;   // Override sleep timeout
  explicitContainerStart?: boolean; // Disable automatic container start
  env?: Record<string, string>;   // Environment variables to pass to the container
  entrypoint?: string[];          // Custom entrypoint to override container default
  enableInternet?: boolean;       // Whether to enable internet access for the container
})
```

#### Methods

##### Lifecycle Methods
- `onBoot(state?)`: Called when container boots successfully - override to add custom behavior
- `onShutdown(state?)`: Called when container shuts down - override to add custom behavior
- `onStateUpdate(state)`: Called when container state is updated - override to add custom behavior
- `onError(error)`: Called when container encounters an error - override to add custom behavior

##### Container Methods
- `startAndWaitForPort(port?, maxTries?)`: Starts the container and waits for a specific port to be ready. If no port is specified, just starts the container without waiting.
- `proxyRequest(request, port?)`: Proxies an HTTP request to the container. Either port parameter or defaultPort must be specified.
- `proxyWebSocket(request, port?)`: Proxies a WebSocket connection to the container. Either port parameter or defaultPort must be specified.
- `shutdownContainer(reason?)`: Stops the container
- `setState(state)`: Updates the container state
- `fetch(request)`: Default handler to proxy HTTP requests to the container
- `renewActivityTimeout()`: Manually renews the container activity timeout (extends container lifetime)
- `shutdownDueToInactivity()`: Called automatically when the container times out due to inactivity

### Utility Functions

- `loadBalance(binding, instances?)`: Load balances requests across multiple container instances
- `randomContainerId(max)`: Generates a random container ID for load balancing
