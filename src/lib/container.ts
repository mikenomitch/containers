import { Server, type Connection, type ConnectionContext, type WebSocket } from "partyserver";
import { AsyncLocalStorage } from "node:async_hooks";
import { nanoid } from "nanoid";
import type {
  ContainerOptions,
  ContainerState,
  Schedule
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
export class Container<Env = unknown> extends (Server as any) {
  // Default port for the container (undefined means no default port)
  defaultPort?: number;

  // Timeout after which the container will sleep if no activity
  sleepAfter: string | number = "5m";

  // Internal tracking for sleep timeout task
  #sleepTimeoutTaskId: string | null = null;

  // Whether to require explicit container start (if false, it starts automatically)
  explicitContainerStart = false;

  /**
   * Default container configuration
   * Configure at class level by overriding in your subclass
   */
  static containerConfig: {
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

      // Instance-specific container configuration overrides are no longer supported
      // If you need to customize container config, extend the Container class and override the static containerConfig
    }

    // Create state table if it doesn't exist
    this.sql`
      CREATE TABLE IF NOT EXISTS container_state (
        id TEXT PRIMARY KEY NOT NULL,
        state TEXT
      )
    `;

    // Create schedules table if it doesn't exist
    this.sql`
      CREATE TABLE IF NOT EXISTS container_schedules (
        id TEXT PRIMARY KEY NOT NULL DEFAULT (randomblob(9)),
        callback TEXT NOT NULL,
        payload TEXT,
        type TEXT NOT NULL CHECK(type IN ('scheduled', 'delayed')),
        time INTEGER NOT NULL,
        delayInSeconds INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `;

    // Process any pending schedules and set up next alarm
    this.ctx.blockConcurrencyWhile(async () => {
      await this.#tryCatch(async () => {
        // Execute any pending schedules
        await this.alarm();
        
        // Schedule next alarms
        await this.#scheduleNextAlarm();
      });
    });

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

    // Variable to track monitor setup
    let monitor;

    // Start the container if it's not running
    if (!this.ctx.container.running) {
      console.log("Starting container...");
      // Use the static class configuration
      const config = (this.constructor as typeof Container).containerConfig;
      this.ctx.container.start({
        env: config.env,
        entrypoint: config.entrypoint,
        enableInternet: config.enableInternet,
      });
      
      // Set up monitoring only when we start the container
      try {
        console.log("Setting up monitoring...");
        // Track container status
        monitor = this.ctx.container.monitor().then(() => {
          this.onShutdown(this.state);
        }).catch((error: unknown) => {
          this.onError(error);
        });
      } catch (e) {
        console.warn("Error setting up container monitor:", e);
      }
    }

    // If no port is specified, just start the container without waiting for port readiness
    if (port === undefined) {
      console.log("No port...");
      // Successfully started the container (without port check)
      this.onBoot(this.state);
      // Initialize activity timeout after successful start
      await this.renewActivityTimeout();
      return;
    }

    console.log("Setting up monitoring...");
    const tcpPort = this.ctx.container.getTcpPort(port);

    // Try to connect to the port multiple times
    for (let i = 0; i < maxTries; i++) {
      try {
        console.log("make fetch...");
        // Use http://ping like in containers-starter-go implementation
        const response = await tcpPort.fetch("http://ping");
        
        // Successfully connected, container is ready
        this.onBoot(this.state);
        // Initialize activity timeout after successful start
        await this.renewActivityTimeout();
        return;
      } catch (e) {
        console.log("ERROR WHILE FETCHING", e);
        
        // Check for specific error messages that indicate we should keep retrying
        const errorMessage = e instanceof Error ? e.message : String(e);
        if (errorMessage.includes("listening") || 
            errorMessage.includes("there is no container instance")) {
          console.log("Container not yet ready, retrying...");
        } else {
          // Log other errors but continue with retries
          console.error("Container connection error:", errorMessage);
        }
      }

      // Wait a bit before trying again (300ms like in containers-starter-go)
      await new Promise(resolve => setTimeout(resolve, 300));
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
   * Parse a time expression into seconds
   * @private
   * @param timeExpression Time expression (number or string like "5m", "30s", "1h")
   * @returns Number of seconds
   */
  #parseTimeExpression(timeExpression: string | number): number {
    if (typeof timeExpression === 'number') {
      // If it's already a number, assume it's in seconds
      return timeExpression;
    } else if (typeof timeExpression === 'string') {
      // Parse time expressions like "5m", "30s", "1h"
      const match = timeExpression.match(/^(\d+)([smh])$/);
      if (!match) {
        // Default to 5 minutes if format is invalid
        return 300;
      } else {
        const value = parseInt(match[1]);
        const unit = match[2];

        // Convert to seconds based on unit
        switch (unit) {
          case 's': return value;
          case 'm': return value * 60;
          case 'h': return value * 60 * 60;
          default: return 300;
        }
      }
    } else {
      // Default to 5 minutes for invalid inputs
      return 300;
    }
  }

  /**
   * Schedule a container shutdown after the specified sleep timeout
   * @private
   */
  async #scheduleSleepTimeout(): Promise<void> {
    // Convert the sleepAfter value to seconds
    const timeoutInSeconds = this.#parseTimeExpression(this.sleepAfter);

    // Cancel any existing timeout
    await this.#cancelSleepTimeout();

    // Schedule the container shutdown
    const { id } = await this.schedule(timeoutInSeconds, "shutdownDueToInactivity");
    this.#sleepTimeoutTaskId = id;
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
   * Schedule a task to be executed in the future
   * @template T Type of the payload data
   * @param when When to execute the task (Date object or number of seconds delay)
   * @param callback Name of the method to call
   * @param payload Data to pass to the callback
   * @returns Schedule object representing the scheduled task
   */
  async schedule<T = string>(
    when: Date | number,
    callback: keyof this,
    payload?: T
  ): Promise<Schedule<T>> {
    const id = nanoid(9);
    
    // Ensure the callback is a string (method name)
    if (typeof callback !== "string") {
      throw new Error("Callback must be a string (method name)");
    }
    
    // Ensure the method exists
    if (typeof this[callback] !== "function") {
      throw new Error(`this.${callback} is not a function`);
    }
    
    // Schedule based on the type of 'when' parameter
    if (when instanceof Date) {
      // Schedule for a specific time
      const timestamp = Math.floor(when.getTime() / 1000);
      
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'scheduled', ${timestamp})
      `;
      
      await this.#scheduleNextAlarm();
      
      return {
        id,
        callback: callback,
        payload: payload as T,
        time: timestamp,
        type: "scheduled",
      };
    } else if (typeof when === "number") {
      // Schedule for a delay in seconds
      const time = Math.floor(Date.now() / 1000 + when);
      
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, delayInSeconds, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'delayed', ${when}, ${time})
      `;
      
      await this.#scheduleNextAlarm();
      
      return {
        id,
        callback: callback,
        payload: payload as T,
        delayInSeconds: when,
        time,
        type: "delayed",
      };
    } else {
      throw new Error("Invalid schedule type. 'when' must be a Date or number of seconds");
    }
  }
  
  /**
   * Schedule the next alarm based on upcoming tasks
   * @private
   */
  async #scheduleNextAlarm(): Promise<void> {
    // Find the next schedule that needs to be executed
    const result = this.sql`
      SELECT time FROM container_schedules 
      WHERE time > ${Math.floor(Date.now() / 1000)}
      ORDER BY time ASC 
      LIMIT 1
    `;
    
    if (result.length > 0 && "time" in result[0]) {
      const nextTime = (result[0].time as number) * 1000;
      await this.ctx.storage.setAlarm(nextTime);
    }
  }
  
  /**
   * Cancel a scheduled task
   * @param id ID of the task to cancel
   * @returns true if the task was cancelled, false if not found
   */
  async unschedule(id: string): Promise<boolean> {
    // Delete the schedule from the database
    this.sql`DELETE FROM container_schedules WHERE id = ${id}`;
    
    // Reschedule the next alarm (if any remain)
    await this.#scheduleNextAlarm();
    
    return true;
  }
  
  /**
   * Get a scheduled task by ID
   * @template T Type of the payload data
   * @param id ID of the scheduled task
   * @returns The Schedule object or undefined if not found
   */
  async getSchedule<T = string>(id: string): Promise<Schedule<T> | undefined> {
    const result = this.sql<{
      id: string;
      callback: string;
      payload: string;
      type: 'scheduled' | 'delayed';
      time: number;
      delayInSeconds?: number;
    }>`
      SELECT * FROM container_schedules WHERE id = ${id} LIMIT 1
    `;
    
    if (!result || result.length === 0) {
      return undefined;
    }
    
    const schedule = result[0];
    let payload: T;
    
    try {
      payload = JSON.parse(schedule.payload) as T;
    } catch (e) {
      console.error(`Error parsing payload for schedule ${id}:`, e);
      payload = undefined as unknown as T;
    }
    
    if (schedule.type === 'delayed') {
      return {
        id: schedule.id,
        callback: schedule.callback,
        payload,
        type: 'delayed',
        time: schedule.time,
        delayInSeconds: schedule.delayInSeconds!
      };
    } else {
      return {
        id: schedule.id,
        callback: schedule.callback,
        payload,
        type: 'scheduled',
        time: schedule.time
      };
    }
  }
  
  /**
   * Get scheduled tasks matching the given criteria
   * @template T Type of the payload data
   * @param criteria Criteria to filter schedules
   * @returns Array of matching Schedule objects
   */
  getSchedules<T = string>(
    criteria: {
      id?: string;
      type?: 'scheduled' | 'delayed';
      timeRange?: { start?: Date; end?: Date };
    } = {}
  ): Schedule<T>[] {
    // Build the query dynamically based on criteria
    let query = "SELECT * FROM container_schedules WHERE 1=1";
    const params: (string | number)[] = [];
    
    // Add filters for each criterion
    if (criteria.id) {
      query += " AND id = ?";
      params.push(criteria.id);
    }
    
    if (criteria.type) {
      query += " AND type = ?";
      params.push(criteria.type);
    }
    
    if (criteria.timeRange) {
      if (criteria.timeRange.start) {
        query += " AND time >= ?";
        params.push(Math.floor(criteria.timeRange.start.getTime() / 1000));
      }
      
      if (criteria.timeRange.end) {
        query += " AND time <= ?";
        params.push(Math.floor(criteria.timeRange.end.getTime() / 1000));
      }
    }
    
    // Execute the query
    const result = this.ctx.storage.sql.exec(query, ...params);
    
    // Transform results to Schedule objects
    return [...result].map(row => {
      let payload: T;
      try {
        payload = JSON.parse(row.payload as string) as T;
      } catch (e) {
        console.error(`Error parsing payload for schedule ${row.id}:`, e);
        payload = undefined as unknown as T;
      }
      
      if (row.type === 'delayed') {
        return {
          id: row.id as string,
          callback: row.callback as string,
          payload,
          type: 'delayed',
          time: row.time as number,
          delayInSeconds: row.delayInSeconds as number
        };
      } else {
        return {
          id: row.id as string,
          callback: row.callback as string,
          payload,
          type: 'scheduled',
          time: row.time as number
        };
      }
    });
  }
  
  /**
   * Method called when an alarm fires
   * Executes any scheduled tasks that are due
   */
  async alarm(): Promise<void> {
    return this.#tryCatch(async () => {
      const now = Math.floor(Date.now() / 1000);
      
      // Get all schedules that should be executed now
      const result = this.sql<{
        id: string;
        callback: string;
        payload: string;
        type: 'scheduled' | 'delayed';
        time: number;
      }>`
        SELECT * FROM container_schedules WHERE time <= ${now}
      `;
      
      // Process each due schedule
      for (const row of result) {
        const callback = this[row.callback as keyof this];
        
        if (!callback || typeof callback !== 'function') {
          console.error(`Callback ${row.callback} not found or is not a function`);
          continue;
        }
        
        // Create a schedule object for context
        const schedule = this.getSchedule(row.id);
        
        try {
          // Parse the payload and execute the callback
          const payload = row.payload ? JSON.parse(row.payload) : undefined;
          
          // Use context storage to execute the callback with proper 'this' binding
          await containerContext.run(
            { 
              container: this, 
              connection: undefined, 
              request: undefined 
            },
            async () => {
              await callback.call(this, payload, await schedule);
            }
          );
        } catch (e) {
          console.error(`Error executing scheduled callback "${row.callback}":`, e);
        }
        
        // Delete the schedule after execution (one-time schedules)
        this.sql`DELETE FROM container_schedules WHERE id = ${row.id}`;
      }
      
      // Schedule the next alarm
      await this.#scheduleNextAlarm();
    });
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
