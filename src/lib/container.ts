import { Server, type Connection, type ConnectionContext, type WebSocket } from "partykit/server";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ContainerOptions,
  ContainerState
} from "../types";

const STATE_ROW_ID = "container_state_row_id";
const STATE_CHANGED_ID = "container_state_changed_id";
const DEFAULT_STATE = {} as ContainerState;

// Context for storing container and connection information
const containerContext = new AsyncLocalStorage<{
  container: Container;
  connection: Connection | undefined;
  request: Request | undefined;
}>();

/**
 * Helper function to get the current container context
 */
export function getCurrentContainer<T extends Container = Container>(): {
  container: T | undefined;
  connection: Connection | undefined;
  request: Request | undefined;
} {
  const store = containerContext.getStore() as
    | {
        container: T;
        connection: Connection | undefined;
        request: Request | undefined;
      }
    | undefined;

  if (!store) {
    return {
      container: undefined,
      connection: undefined,
      request: undefined,
    };
  }
  return store;
}

/**
 * Main Container class that wraps PartyKit's Server with container functionality
 */
export class Container<Env = unknown> extends Server<Env> {
  // Default port for the container (undefined means no default port)
  defaultPort?: number;

  // Timeout after which the container will sleep if no activity
  sleepAfter: string | number = "5m";

  // Internal tracking for sleep timeout task
  #sleepTimeoutTaskId: string | null = null;

  // Whether to require explicit container start (if false, it starts automatically)
  explicitContainerStart = false;

  // Default container configuration
  containerConfig: {
    env?: Record<string, string>;
    entrypoint?: string[];
    enableInternet?: boolean;
  } = {
    env: {},
    enableInternet: true
  };

  // Internal state
  #state = DEFAULT_STATE;
  /**
   * Initial state for the Container
   */
  initialState: ContainerState = DEFAULT_STATE;

  /**
   * Current state of the Container
   */
  get state(): ContainerState {
    if (this.#state !== DEFAULT_STATE) {
      // State was previously set
      return this.#state;
    }

    // Check if state was set in previous session
    const wasChanged = this.sql<{ state: "true" | undefined }>`
      SELECT state FROM container_state WHERE id = ${STATE_CHANGED_ID}
    `;

    // Get the actual state from the database
    const result = this.sql<{ state: ContainerState | undefined }>`
      SELECT state FROM container_state WHERE id = ${STATE_ROW_ID}
    `;

    if (
      wasChanged[0]?.state === "true" ||
      result[0]?.state
    ) {
      // Convert the state to string before parsing
      const stateStr = JSON.stringify(result[0]?.state);
      this.#state = JSON.parse(stateStr);
      return this.#state;
    }

    // First time access, set initial state if provided
    if (this.initialState === DEFAULT_STATE) {
      return {} as ContainerState;
    }

    this.setState(this.initialState);
    return this.initialState;
  }

  /**
   * Container configuration options
   */
  static options = {
    hibernate: true, // default to hibernate when idle
  };

  /**
   * Execute SQL queries against the Container's database
   */
  sql<T = Record<string, string | number | boolean | null>>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ) {
    let query = "";
    try {
      // Construct the SQL query with placeholders
      query = strings.reduce(
        (acc, str, i) => acc + str + (i < values.length ? "?" : ""),
        ""
      );

      // Execute the SQL query with the provided values
      return [...this.ctx.storage.sql.exec(query, ...values)] as T[];
    } catch (e) {
      console.error(`Failed to execute SQL query: ${query}`, e);
      throw this.onError(e);
    }
  }

  constructor(ctx: any, env: Env, options?: ContainerOptions) {
    super(ctx, env);

    // Apply options if provided
    if (options) {
      if (options.defaultPort !== undefined) this.defaultPort = options.defaultPort;
      if (options.sleepAfter !== undefined) this.sleepAfter = options.sleepAfter;
      if (options.explicitContainerStart !== undefined) this.explicitContainerStart = options.explicitContainerStart;

      // Apply container configuration if provided
      if (options.env) this.containerConfig.env = options.env;
      if (options.entrypoint) this.containerConfig.entrypoint = options.entrypoint;
      if (options.enableInternet !== undefined) this.containerConfig.enableInternet = options.enableInternet;
    }

    // Create state table if it doesn't exist
    this.sql`
      CREATE TABLE IF NOT EXISTS container_state (
        id TEXT PRIMARY KEY NOT NULL,
        state TEXT
      )
    `;


    // Start the container automatically if needed
    this.ctx.blockConcurrencyWhile(async () => {
      if (this.shouldAutoStart()) {
        // Start container without waiting for port if defaultPort is not set
        await this.startAndWaitForPort(this.defaultPort);
        // Activity timeout is initialized in startAndWaitForPort
      }
    });
  }

  /**
   * Determine if container should auto-start
   */
  shouldAutoStart(): boolean {
    return !this.explicitContainerStart; // Auto-start unless explicitly disabled
  }

  /**
   * Start the container and wait for a port to be available (if port is specified)
   * Based on containers-starter-go implementation
   */
  async startAndWaitForPort(port?: number, maxTries: number = 10): Promise<void> {
    if (!this.ctx.container) {
      throw new Error("No container found in context");
    }

    // Start the container if it's not running
    if (!this.ctx.container.running) {
      this.ctx.container.start({
        env: this.containerConfig.env,
        entrypoint: this.containerConfig.entrypoint,
        enableInternet: this.containerConfig.enableInternet,
      });
    }

    // Set up monitoring to track container status
    try {
      // Track container status
      this.ctx.container.monitor().then(() => {
        this.onShutdown(this.state);
      }).catch((error: unknown) => {
        this.onError(error);
      });
    } catch (e) {
      console.warn("Error setting up container monitor:", e);
    }

    // If no port is specified, just start the container without waiting for port readiness
    if (port === undefined) {
      // Successfully started the container (without port check)
      this.onBoot(this.state);
      // Initialize activity timeout after successful start
      await this.renewActivityTimeout();
      return;
    }

    const tcpPort = this.ctx.container.getTcpPort(port);

    // Try to connect to the port multiple times
    for (let i = 0; i < maxTries; i++) {
      try {
        const response = await tcpPort.fetch("http://container/");
        // 599 is a special status code used when the container isn't ready yet
        if (response.status !== 599) {
          // Successfully connected, container is ready
          this.onBoot(this.state);
          // Initialize activity timeout after successful start
          await this.renewActivityTimeout();
          return;
        }
      } catch (e) {
        // Ignore errors and try again
      }

      // Wait a bit before trying again
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`Failed to verify container is running after ${maxTries} attempts`);
  }

  /**
   * Proxy an HTTP request to the container
   * Based on containers-starter-go implementation
   */
  async proxyRequest(request: Request, port?: number): Promise<Response> {
    if (!this.ctx.container) {
      throw new Error("No container found in context");
    }

    // Require a port to be specified, either as a parameter or as a defaultPort property
    if (port === undefined && this.defaultPort === undefined) {
      throw new Error("No port specified for proxy request. Set defaultPort or specify a port parameter.");
    }

    // Use specified port or defaultPort
    const targetPort = port ?? this.defaultPort;

    if (!this.ctx.container.running) {
      try {
        await this.startAndWaitForPort(targetPort);
      } catch (e) {
        return new Response(`Failed to start container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
      }
    }

    const tcpPort = this.ctx.container.getTcpPort(targetPort!);

    // Create URL for the container request
    const url = new URL(request.url);
    // Ensure we handle URLs properly whether they have search params or not
    const containerUrl = `http://container${url.pathname}${url.search || ''}`;

    // Clone the request to forward to the container
    const requestInit: RequestInit = {
      method: request.method,
      headers: request.headers,
    };

    // Add body for non-GET/HEAD requests
    if (request.method !== "GET" && request.method !== "HEAD") {
      requestInit.body = await request.clone().arrayBuffer();
    }

    try {
      // Renew the activity timeout whenever a request is proxied
      await this.renewActivityTimeout();
      return await tcpPort.fetch(containerUrl, requestInit);
    } catch (e) {
      console.error("Error proxying request to container:", e);
      return new Response(`Error proxying request to container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
    }
  }

  /**
   * Shuts down the container
   */
  async shutdownContainer(reason?: string): Promise<void> {
    if (!this.ctx.container || !this.ctx.container.running) {
      return;
    }

    // Cancel any pending sleep timeout
    await this.#cancelSleepTimeout();

    this.ctx.container.destroy(reason || "Container shutdown requested");

    // Call shutdown handler
    this.onShutdown(this.state);
  }

  /**
   * Update the container's state
   */
  setState(state: ContainerState): void {
    this.#setStateInternal(state, "server");
  }

  /**
   * Internal method to update state and notify clients
   */
  #setStateInternal(state: ContainerState, source: Connection | "server" = "server"): void {
    this.#state = state;

    // Store state in database
    this.sql`
      INSERT OR REPLACE INTO container_state (id, state)
      VALUES (${STATE_ROW_ID}, ${JSON.stringify(state)})
    `;

    this.sql`
      INSERT OR REPLACE INTO container_state (id, state)
      VALUES (${STATE_CHANGED_ID}, ${JSON.stringify(true)})
    `;

    // Broadcast state change to all clients except the source
    this.broadcast(
      JSON.stringify({
        type: "container_state",
        state: state,
      }),
      source !== "server" ? [source.id] : []
    );

    // Call onStateUpdate hook
    this.onStateUpdate(state);
  }

  /**
   * Lifecycle method called when container boots successfully
   * Override this method in subclasses to handle container boot events
   */
  onBoot(state?: ContainerState): void | Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Lifecycle method called when container shuts down
   * Override this method in subclasses to handle container shutdown events
   */
  onShutdown(state?: ContainerState): void | Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Lifecycle method called when container state is updated
   * Override this method in subclasses to handle state changes
   */
  onStateUpdate(state: ContainerState): void | Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Error handler for container errors
   * Override this method in subclasses to handle container errors
   */
  onError(error: unknown): any {
    console.error("Container error:", error);
    throw error;
  }

  /**
   * Try-catch wrapper for async operations
   */
  async #tryCatch<T>(fn: () => T | Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw this.onError(e);
    }
  }

  /**
   * Schedule a container shutdown after the specified sleep timeout
   * @private
   */
  async #scheduleSleepTimeout(): Promise<void> {
    // Convert the sleepAfter value to seconds
    let timeoutInSeconds: number;

    if (typeof this.sleepAfter === 'number') {
      // If it's already a number, assume it's in seconds
      timeoutInSeconds = this.sleepAfter;
    } else if (typeof this.sleepAfter === 'string') {
      // Parse time expressions like "5m", "30s", "1h"
      const match = this.sleepAfter.match(/^(\d+)([smh])$/);
      if (!match) {
        // Default to 5 minutes if format is invalid
        timeoutInSeconds = 300;
      } else {
        const value = parseInt(match[1]);
        const unit = match[2];

        // Convert to seconds based on unit
        switch (unit) {
          case 's': timeoutInSeconds = value; break;
          case 'm': timeoutInSeconds = value * 60; break;
          case 'h': timeoutInSeconds = value * 60 * 60; break;
          default: timeoutInSeconds = 300;
        }
      }
    } else {
      // Default to 5 minutes
      timeoutInSeconds = 300;
    }

    // Cancel any existing timeout
    await this.#cancelSleepTimeout();

    // Schedule the container shutdown
    const { taskId } = await this.schedule(timeoutInSeconds, "shutdownDueToInactivity");
    this.#sleepTimeoutTaskId = taskId;
  }

  /**
   * Cancel the scheduled sleep timeout if one exists
   * @private
   */
  async #cancelSleepTimeout(): Promise<void> {
    if (this.#sleepTimeoutTaskId) {
      try {
        await this.unschedule(this.#sleepTimeoutTaskId);
      } catch (e) {
        // Ignore errors (task may have already completed)
      }
      this.#sleepTimeoutTaskId = null;
    }
  }

  /**
   * Renew the container's activity timeout
   * Call this method whenever there is activity on the container
   */
  async renewActivityTimeout(): Promise<void> {
    if (this.ctx?.container?.running) {
      await this.#scheduleSleepTimeout();
    }
  }

  /**
   * Method called by scheduled task to shutdown the container due to inactivity
   */
  async shutdownDueToInactivity(): Promise<void> {
    // Clear the task ID since it's been executed
    this.#sleepTimeoutTaskId = null;

    // Shutdown the container if it's still running
    this.shutdownContainer("Container shut down due to inactivity timeout");
  }

  /**
   * Proxy a WebSocket connection to the container
   * @param request The WebSocket upgrade request
   * @param port The port to connect to (defaults to this.defaultPort if not specified)
   * @returns A Response with webSocket set to handle the upgrade
   */
  async proxyWebSocket(request: Request, port?: number): Promise<Response> {
    if (!this.ctx.container) {
      throw new Error("No container found in context");
    }

    // Require a port to be specified, either as a parameter or as a defaultPort property
    if (port === undefined && this.defaultPort === undefined) {
      throw new Error("No port specified for WebSocket proxy. Set defaultPort or specify a port parameter.");
    }

    // Use specified port or defaultPort
    const targetPort = port ?? this.defaultPort;

    // Ensure container is running
    if (!this.ctx.container.running) {
      try {
        // Start container and wait for port to be ready
        await this.startAndWaitForPort(targetPort);
      } catch (e) {
        return new Response(`Failed to start container for WebSocket: ${e instanceof Error ? e.message : String(e)}`,
          { status: 500 });
      }
    }

    // Get TCP port
    const tcpPort = this.ctx.container.getTcpPort(targetPort!);

    // Renew the activity timeout
    await this.renewActivityTimeout();

    try {
      // Create a WebSocket connection to the container
      const containerRes = await tcpPort.fetch("http://container/ws", {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade'
        }
      });

      // Check if we got a WebSocket from the container
      // @ts-ignore - The webSocket property is not in the Response type but is provided by PartyKit
      if (!containerRes.webSocket) {
        return new Response('Container WebSocket server is not available', { status: 500 });
      }

      // Create a WebSocket pair for the client
      // @ts-ignore - WebSocketPair is provided by PartyKit
      const pair = new WebSocketPair();
      const clientWs = pair[0];
      const serverWs = pair[1];

      // Accept the WebSocket connection from the client
      serverWs.accept();
      // @ts-ignore - The webSocket property is not in the Response type but is provided by PartyKit
      containerRes.webSocket.accept();

      // Forward messages from client to container
      serverWs.addEventListener('message', (event: { data: string | ArrayBufferLike }) => {
        try {
          // Renew timeout on activity
          this.renewActivityTimeout();
          // Forward message to container
          // @ts-ignore - The webSocket property is not in the Response type but is provided by PartyKit
          containerRes.webSocket?.send(event.data);
        } catch (e) {
          console.error('Error forwarding message to container:', e);
        }
      });

      // Forward messages from container to client
      // @ts-ignore - The webSocket property is not in the Response type but is provided by PartyKit
      containerRes.webSocket.addEventListener('message', (event: { data: string | ArrayBufferLike }) => {
        try {
          // Renew timeout on activity
          this.renewActivityTimeout();
          // Forward message to client
          serverWs.send(event.data);
        } catch (e) {
          console.error('Error forwarding message to client:', e);
        }
      });

      // Handle client closing the connection
      serverWs.addEventListener('close', (event: { code: number; reason: string }) => {
        try {
          // @ts-ignore - The webSocket property is not in the Response type but is provided by PartyKit
          containerRes.webSocket?.close(event.code, event.reason);
        } catch (e) {
          console.error('Error closing container WebSocket:', e);
        }
      });

      // Handle container closing the connection
      // @ts-ignore - The webSocket property is not in the Response type but is provided by PartyKit
      containerRes.webSocket.addEventListener('close', (event: { code: number; reason: string }) => {
        try {
          serverWs.close(event.code, event.reason);
        } catch (e) {
          console.error('Error closing client WebSocket:', e);
        }
      });

      // Handle errors on both sides
      serverWs.addEventListener('error', (event: any) => {
        console.error('Client WebSocket error:', event);
        try {
          // @ts-ignore - The webSocket property is not in the Response type but is provided by PartyKit
          containerRes.webSocket?.close(1011, 'Error in client WebSocket');
        } catch (e) {
          // Ignore
        }
      });

      // @ts-ignore - The webSocket property is not in the Response type but is provided by PartyKit
      containerRes.webSocket.addEventListener('error', (event: any) => {
        console.error('Container WebSocket error:', event);
        try {
          serverWs.close(1011, 'Error in container WebSocket');
        } catch (e) {
          // Ignore
        }
      });

      // Return the client side of the WebSocket pair
      return new Response(null, {
        status: 101,
        // @ts-ignore - The webSocket property is not in the ResponseInit type but is supported by PartyKit
        webSocket: clientWs
      });
    } catch (e) {
      console.error('Error establishing WebSocket connection:', e);
      return new Response(`Error establishing WebSocket connection: ${e instanceof Error ? e.message : String(e)}`,
        { status: 500 });
    }
  }

  /**
   * Handle fetch requests to the Container
   * Default implementation proxies HTTP requests to the container
   * Override this in your subclass to specify a port or implement custom request handling
   */
  async fetch(request: Request): Promise<Response> {
    // Renew the activity timeout whenever a request is received
    await this.renewActivityTimeout();

    // Check if default port is set
    if (this.defaultPort === undefined) {
      return new Response(
        "No default port configured for this container. Override the fetch method or set defaultPort in your Container subclass.",
        { status: 500 }
      );
    }

    // Check if this is a WebSocket upgrade request
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.proxyWebSocket(request, this.defaultPort);
    }

    // Proxy the HTTP request to the container
    return await this.proxyRequest(request, this.defaultPort);
  }
}
