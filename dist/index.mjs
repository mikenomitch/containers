var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// src/lib/container.ts
import { Server } from "partykit/server";
import { AsyncLocalStorage } from "node:async_hooks";
var STATE_ROW_ID = "container_state_row_id";
var STATE_CHANGED_ID = "container_state_changed_id";
var DEFAULT_STATE = {};
var containerContext = new AsyncLocalStorage();
function getCurrentContainer() {
  const store = containerContext.getStore();
  if (!store) {
    return {
      container: void 0,
      connection: void 0,
      request: void 0
    };
  }
  return store;
}
var _sleepTimeoutTaskId, _state, _Container_instances, setStateInternal_fn, tryCatch_fn, scheduleSleepTimeout_fn, cancelSleepTimeout_fn;
var Container = class extends Server {
  constructor(ctx, env, options) {
    super(ctx, env);
    __privateAdd(this, _Container_instances);
    // Timeout after which the container will sleep if no activity
    this.sleepAfter = "5m";
    // Internal tracking for sleep timeout task
    __privateAdd(this, _sleepTimeoutTaskId, null);
    // Whether to require explicit container start (if false, it starts automatically)
    this.explicitContainerStart = false;
    // Default container configuration
    this.containerConfig = {
      env: {},
      enableInternet: true
    };
    // Internal state
    __privateAdd(this, _state, DEFAULT_STATE);
    /**
     * Initial state for the Container
     */
    this.initialState = DEFAULT_STATE;
    if (options) {
      if (options.defaultPort !== void 0) this.defaultPort = options.defaultPort;
      if (options.sleepAfter !== void 0) this.sleepAfter = options.sleepAfter;
      if (options.explicitContainerStart !== void 0) this.explicitContainerStart = options.explicitContainerStart;
      if (options.env) this.containerConfig.env = options.env;
      if (options.entrypoint) this.containerConfig.entrypoint = options.entrypoint;
      if (options.enableInternet !== void 0) this.containerConfig.enableInternet = options.enableInternet;
    }
    this.sql`
      CREATE TABLE IF NOT EXISTS container_state (
        id TEXT PRIMARY KEY NOT NULL,
        state TEXT
      )
    `;
    this.ctx.blockConcurrencyWhile(async () => {
      if (this.shouldAutoStart()) {
        await this.startAndWaitForPort(this.defaultPort);
      }
    });
  }
  /**
   * Current state of the Container
   */
  get state() {
    if (__privateGet(this, _state) !== DEFAULT_STATE) {
      return __privateGet(this, _state);
    }
    const wasChanged = this.sql`
      SELECT state FROM container_state WHERE id = ${STATE_CHANGED_ID}
    `;
    const result = this.sql`
      SELECT state FROM container_state WHERE id = ${STATE_ROW_ID}
    `;
    if (wasChanged[0]?.state === "true" || result[0]?.state) {
      const stateStr = JSON.stringify(result[0]?.state);
      __privateSet(this, _state, JSON.parse(stateStr));
      return __privateGet(this, _state);
    }
    if (this.initialState === DEFAULT_STATE) {
      return {};
    }
    this.setState(this.initialState);
    return this.initialState;
  }
  /**
   * Execute SQL queries against the Container's database
   */
  sql(strings, ...values) {
    let query = "";
    try {
      query = strings.reduce(
        (acc, str, i) => acc + str + (i < values.length ? "?" : ""),
        ""
      );
      return [...this.ctx.storage.sql.exec(query, ...values)];
    } catch (e) {
      console.error(`Failed to execute SQL query: ${query}`, e);
      throw this.onError(e);
    }
  }
  /**
   * Determine if container should auto-start
   */
  shouldAutoStart() {
    return !this.explicitContainerStart;
  }
  /**
   * Start the container and wait for a port to be available (if port is specified)
   * Based on containers-starter-go implementation
   */
  async startAndWaitForPort(port, maxTries = 10) {
    if (!this.ctx.container) {
      throw new Error("No container found in context");
    }
    if (!this.ctx.container.running) {
      this.ctx.container.start({
        env: this.containerConfig.env,
        entrypoint: this.containerConfig.entrypoint,
        enableInternet: this.containerConfig.enableInternet
      });
    }
    try {
      this.ctx.container.monitor().then(() => {
        this.onShutdown(this.state);
      }).catch((error) => {
        this.onError(error);
      });
    } catch (e) {
      console.warn("Error setting up container monitor:", e);
    }
    if (port === void 0) {
      this.onBoot(this.state);
      await this.renewActivityTimeout();
      return;
    }
    const tcpPort = this.ctx.container.getTcpPort(port);
    for (let i = 0; i < maxTries; i++) {
      try {
        const response = await tcpPort.fetch("http://container/");
        if (response.status !== 599) {
          this.onBoot(this.state);
          await this.renewActivityTimeout();
          return;
        }
      } catch (e) {
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Failed to verify container is running after ${maxTries} attempts`);
  }
  /**
   * Proxy an HTTP request to the container
   * Based on containers-starter-go implementation
   */
  async proxyRequest(request, port) {
    if (!this.ctx.container) {
      throw new Error("No container found in context");
    }
    if (port === void 0 && this.defaultPort === void 0) {
      throw new Error("No port specified for proxy request. Set defaultPort or specify a port parameter.");
    }
    const targetPort = port ?? this.defaultPort;
    if (!this.ctx.container.running) {
      try {
        await this.startAndWaitForPort(targetPort);
      } catch (e) {
        return new Response(`Failed to start container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
      }
    }
    const tcpPort = this.ctx.container.getTcpPort(targetPort);
    const url = new URL(request.url);
    const containerUrl = `http://container${url.pathname}${url.search || ""}`;
    const requestInit = {
      method: request.method,
      headers: request.headers
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      requestInit.body = await request.clone().arrayBuffer();
    }
    try {
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
  async shutdownContainer(reason) {
    if (!this.ctx.container || !this.ctx.container.running) {
      return;
    }
    await __privateMethod(this, _Container_instances, cancelSleepTimeout_fn).call(this);
    this.ctx.container.destroy(reason || "Container shutdown requested");
    this.onShutdown(this.state);
  }
  /**
   * Update the container's state
   */
  setState(state) {
    __privateMethod(this, _Container_instances, setStateInternal_fn).call(this, state, "server");
  }
  /**
   * Lifecycle method called when container boots successfully
   * Override this method in subclasses to handle container boot events
   */
  onBoot(state) {
  }
  /**
   * Lifecycle method called when container shuts down
   * Override this method in subclasses to handle container shutdown events
   */
  onShutdown(state) {
  }
  /**
   * Lifecycle method called when container state is updated
   * Override this method in subclasses to handle state changes
   */
  onStateUpdate(state) {
  }
  /**
   * Error handler for container errors
   * Override this method in subclasses to handle container errors
   */
  onError(error) {
    console.error("Container error:", error);
    throw error;
  }
  /**
   * Renew the container's activity timeout
   * Call this method whenever there is activity on the container
   */
  async renewActivityTimeout() {
    if (this.ctx?.container?.running) {
      await __privateMethod(this, _Container_instances, scheduleSleepTimeout_fn).call(this);
    }
  }
  /**
   * Method called by scheduled task to shutdown the container due to inactivity
   */
  async shutdownDueToInactivity() {
    __privateSet(this, _sleepTimeoutTaskId, null);
    this.shutdownContainer("Container shut down due to inactivity timeout");
  }
  /**
   * Proxy a WebSocket connection to the container
   * @param request The WebSocket upgrade request
   * @param port The port to connect to (defaults to this.defaultPort if not specified)
   * @returns A Response with webSocket set to handle the upgrade
   */
  async proxyWebSocket(request, port) {
    if (!this.ctx.container) {
      throw new Error("No container found in context");
    }
    if (port === void 0 && this.defaultPort === void 0) {
      throw new Error("No port specified for WebSocket proxy. Set defaultPort or specify a port parameter.");
    }
    const targetPort = port ?? this.defaultPort;
    if (!this.ctx.container.running) {
      try {
        await this.startAndWaitForPort(targetPort);
      } catch (e) {
        return new Response(
          `Failed to start container for WebSocket: ${e instanceof Error ? e.message : String(e)}`,
          { status: 500 }
        );
      }
    }
    const tcpPort = this.ctx.container.getTcpPort(targetPort);
    await this.renewActivityTimeout();
    try {
      const containerRes = await tcpPort.fetch("http://container/ws", {
        headers: {
          "Upgrade": "websocket",
          "Connection": "Upgrade"
        }
      });
      if (!containerRes.webSocket) {
        return new Response("Container WebSocket server is not available", { status: 500 });
      }
      const pair = new WebSocketPair();
      const clientWs = pair[0];
      const serverWs = pair[1];
      serverWs.accept();
      containerRes.webSocket.accept();
      serverWs.addEventListener("message", (event) => {
        try {
          this.renewActivityTimeout();
          containerRes.webSocket?.send(event.data);
        } catch (e) {
          console.error("Error forwarding message to container:", e);
        }
      });
      containerRes.webSocket.addEventListener("message", (event) => {
        try {
          this.renewActivityTimeout();
          serverWs.send(event.data);
        } catch (e) {
          console.error("Error forwarding message to client:", e);
        }
      });
      serverWs.addEventListener("close", (event) => {
        try {
          containerRes.webSocket?.close(event.code, event.reason);
        } catch (e) {
          console.error("Error closing container WebSocket:", e);
        }
      });
      containerRes.webSocket.addEventListener("close", (event) => {
        try {
          serverWs.close(event.code, event.reason);
        } catch (e) {
          console.error("Error closing client WebSocket:", e);
        }
      });
      serverWs.addEventListener("error", (event) => {
        console.error("Client WebSocket error:", event);
        try {
          containerRes.webSocket?.close(1011, "Error in client WebSocket");
        } catch (e) {
        }
      });
      containerRes.webSocket.addEventListener("error", (event) => {
        console.error("Container WebSocket error:", event);
        try {
          serverWs.close(1011, "Error in container WebSocket");
        } catch (e) {
        }
      });
      return new Response(null, {
        status: 101,
        // @ts-ignore - The webSocket property is not in the ResponseInit type but is supported by PartyKit
        webSocket: clientWs
      });
    } catch (e) {
      console.error("Error establishing WebSocket connection:", e);
      return new Response(
        `Error establishing WebSocket connection: ${e instanceof Error ? e.message : String(e)}`,
        { status: 500 }
      );
    }
  }
  /**
   * Handle fetch requests to the Container
   * Default implementation proxies HTTP requests to the container
   * Override this in your subclass to specify a port or implement custom request handling
   */
  async fetch(request) {
    await this.renewActivityTimeout();
    if (this.defaultPort === void 0) {
      return new Response(
        "No default port configured for this container. Override the fetch method or set defaultPort in your Container subclass.",
        { status: 500 }
      );
    }
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.proxyWebSocket(request, this.defaultPort);
    }
    return await this.proxyRequest(request, this.defaultPort);
  }
};
_sleepTimeoutTaskId = new WeakMap();
_state = new WeakMap();
_Container_instances = new WeakSet();
/**
 * Internal method to update state and notify clients
 */
setStateInternal_fn = function(state, source = "server") {
  __privateSet(this, _state, state);
  this.sql`
      INSERT OR REPLACE INTO container_state (id, state)
      VALUES (${STATE_ROW_ID}, ${JSON.stringify(state)})
    `;
  this.sql`
      INSERT OR REPLACE INTO container_state (id, state)
      VALUES (${STATE_CHANGED_ID}, ${JSON.stringify(true)})
    `;
  this.broadcast(
    JSON.stringify({
      type: "container_state",
      state
    }),
    source !== "server" ? [source.id] : []
  );
  this.onStateUpdate(state);
};
tryCatch_fn = async function(fn) {
  try {
    return await fn();
  } catch (e) {
    throw this.onError(e);
  }
};
scheduleSleepTimeout_fn = async function() {
  let timeoutInSeconds;
  if (typeof this.sleepAfter === "number") {
    timeoutInSeconds = this.sleepAfter;
  } else if (typeof this.sleepAfter === "string") {
    const match = this.sleepAfter.match(/^(\d+)([smh])$/);
    if (!match) {
      timeoutInSeconds = 300;
    } else {
      const value = parseInt(match[1]);
      const unit = match[2];
      switch (unit) {
        case "s":
          timeoutInSeconds = value;
          break;
        case "m":
          timeoutInSeconds = value * 60;
          break;
        case "h":
          timeoutInSeconds = value * 60 * 60;
          break;
        default:
          timeoutInSeconds = 300;
      }
    }
  } else {
    timeoutInSeconds = 300;
  }
  await __privateMethod(this, _Container_instances, cancelSleepTimeout_fn).call(this);
  const { taskId } = await this.schedule(timeoutInSeconds, "shutdownDueToInactivity");
  __privateSet(this, _sleepTimeoutTaskId, taskId);
};
cancelSleepTimeout_fn = async function() {
  if (__privateGet(this, _sleepTimeoutTaskId)) {
    try {
      await this.unschedule(__privateGet(this, _sleepTimeoutTaskId));
    } catch (e) {
    }
    __privateSet(this, _sleepTimeoutTaskId, null);
  }
};
/**
 * Container configuration options
 */
Container.options = {
  hibernate: true
  // default to hibernate when idle
};

// src/lib/utils.ts
function randomContainerId(max) {
  return Math.floor(Math.random() * max);
}
async function loadBalance(binding, instances = 3) {
  const id = randomContainerId(instances).toString();
  const objectId = binding.idFromString(id);
  return binding.get(objectId);
}
export {
  Container,
  getCurrentContainer,
  loadBalance,
  randomContainerId
};
