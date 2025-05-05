"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Container: () => Container,
  getCurrentContainer: () => getCurrentContainer,
  loadBalance: () => loadBalance,
  randomContainerId: () => randomContainerId
});
module.exports = __toCommonJS(index_exports);

// src/lib/container.ts
var import_partyserver = require("partyserver");
var import_node_async_hooks = require("async_hooks");

// node_modules/nanoid/index.js
var import_node_crypto = require("crypto");

// node_modules/nanoid/url-alphabet/index.js
var urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

// node_modules/nanoid/index.js
var POOL_SIZE_MULTIPLIER = 128;
var pool;
var poolOffset;
function fillPool(bytes) {
  if (!pool || pool.length < bytes) {
    pool = Buffer.allocUnsafe(bytes * POOL_SIZE_MULTIPLIER);
    import_node_crypto.webcrypto.getRandomValues(pool);
    poolOffset = 0;
  } else if (poolOffset + bytes > pool.length) {
    import_node_crypto.webcrypto.getRandomValues(pool);
    poolOffset = 0;
  }
  poolOffset += bytes;
}
function nanoid(size = 21) {
  fillPool(size |= 0);
  let id = "";
  for (let i = poolOffset - size; i < poolOffset; i++) {
    id += urlAlphabet[pool[i] & 63];
  }
  return id;
}

// src/lib/container.ts
var STATE_ROW_ID = "container_state_row_id";
var STATE_CHANGED_ID = "container_state_changed_id";
var DEFAULT_STATE = {};
var containerContext = new import_node_async_hooks.AsyncLocalStorage();
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
var _sleepTimeoutTaskId, _state, _Container_instances, setStateInternal_fn, tryCatch_fn, parseTimeExpression_fn, scheduleSleepTimeout_fn, cancelSleepTimeout_fn, scheduleNextAlarm_fn;
var Container = class extends import_partyserver.Server {
  constructor(ctx, env, options) {
    super(ctx, env);
    __privateAdd(this, _Container_instances);
    // Timeout after which the container will sleep if no activity
    this.sleepAfter = "5m";
    // Internal tracking for sleep timeout task
    __privateAdd(this, _sleepTimeoutTaskId, null);
    // Whether to require explicit container start (if false, it starts automatically)
    this.explicitContainerStart = false;
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
    }
    this.sql`
      CREATE TABLE IF NOT EXISTS container_state (
        id TEXT PRIMARY KEY NOT NULL,
        state TEXT
      )
    `;
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
    this.ctx.blockConcurrencyWhile(async () => {
      await __privateMethod(this, _Container_instances, tryCatch_fn).call(this, async () => {
        await this.alarm();
        await __privateMethod(this, _Container_instances, scheduleNextAlarm_fn).call(this);
      });
    });
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
    let monitor;
    if (!this.ctx.container.running) {
      console.log("Starting container...");
      const config = this.constructor.containerConfig;
      this.ctx.container.start({
        env: config.env,
        entrypoint: config.entrypoint,
        enableInternet: config.enableInternet
      });
      try {
        console.log("Setting up monitoring...");
        monitor = this.ctx.container.monitor().then(() => {
          this.onShutdown(this.state);
        }).catch((error) => {
          this.onError(error);
        });
      } catch (e) {
        console.warn("Error setting up container monitor:", e);
      }
    }
    if (port === void 0) {
      console.log("No port...");
      this.onBoot(this.state);
      await this.renewActivityTimeout();
      return;
    }
    console.log("Setting up monitoring...");
    const tcpPort = this.ctx.container.getTcpPort(port);
    for (let i = 0; i < maxTries; i++) {
      try {
        console.log("make fetch...");
        const response = await tcpPort.fetch("http://ping");
        this.onBoot(this.state);
        await this.renewActivityTimeout();
        return;
      } catch (e) {
        console.log("ERROR WHILE FETCHING", e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        if (errorMessage.includes("listening") || errorMessage.includes("there is no container instance")) {
          console.log("Container not yet ready, retrying...");
        } else {
          console.error("Container connection error:", errorMessage);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
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
   * Schedule a task to be executed in the future
   * @template T Type of the payload data
   * @param when When to execute the task (Date object or number of seconds delay)
   * @param callback Name of the method to call
   * @param payload Data to pass to the callback
   * @returns Schedule object representing the scheduled task
   */
  async schedule(when, callback, payload) {
    const id = nanoid(9);
    if (typeof callback !== "string") {
      throw new Error("Callback must be a string (method name)");
    }
    if (typeof this[callback] !== "function") {
      throw new Error(`this.${callback} is not a function`);
    }
    if (when instanceof Date) {
      const timestamp = Math.floor(when.getTime() / 1e3);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'scheduled', ${timestamp})
      `;
      await __privateMethod(this, _Container_instances, scheduleNextAlarm_fn).call(this);
      return {
        id,
        callback,
        payload,
        time: timestamp,
        type: "scheduled"
      };
    } else if (typeof when === "number") {
      const time = Math.floor(Date.now() / 1e3 + when);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, delayInSeconds, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'delayed', ${when}, ${time})
      `;
      await __privateMethod(this, _Container_instances, scheduleNextAlarm_fn).call(this);
      return {
        id,
        callback,
        payload,
        delayInSeconds: when,
        time,
        type: "delayed"
      };
    } else {
      throw new Error("Invalid schedule type. 'when' must be a Date or number of seconds");
    }
  }
  /**
   * Cancel a scheduled task
   * @param id ID of the task to cancel
   * @returns true if the task was cancelled, false if not found
   */
  async unschedule(id) {
    this.sql`DELETE FROM container_schedules WHERE id = ${id}`;
    await __privateMethod(this, _Container_instances, scheduleNextAlarm_fn).call(this);
    return true;
  }
  /**
   * Get a scheduled task by ID
   * @template T Type of the payload data
   * @param id ID of the scheduled task
   * @returns The Schedule object or undefined if not found
   */
  async getSchedule(id) {
    const result = this.sql`
      SELECT * FROM container_schedules WHERE id = ${id} LIMIT 1
    `;
    if (!result || result.length === 0) {
      return void 0;
    }
    const schedule = result[0];
    let payload;
    try {
      payload = JSON.parse(schedule.payload);
    } catch (e) {
      console.error(`Error parsing payload for schedule ${id}:`, e);
      payload = void 0;
    }
    if (schedule.type === "delayed") {
      return {
        id: schedule.id,
        callback: schedule.callback,
        payload,
        type: "delayed",
        time: schedule.time,
        delayInSeconds: schedule.delayInSeconds
      };
    } else {
      return {
        id: schedule.id,
        callback: schedule.callback,
        payload,
        type: "scheduled",
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
  getSchedules(criteria = {}) {
    let query = "SELECT * FROM container_schedules WHERE 1=1";
    const params = [];
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
        params.push(Math.floor(criteria.timeRange.start.getTime() / 1e3));
      }
      if (criteria.timeRange.end) {
        query += " AND time <= ?";
        params.push(Math.floor(criteria.timeRange.end.getTime() / 1e3));
      }
    }
    const result = this.ctx.storage.sql.exec(query, ...params);
    return [...result].map((row) => {
      let payload;
      try {
        payload = JSON.parse(row.payload);
      } catch (e) {
        console.error(`Error parsing payload for schedule ${row.id}:`, e);
        payload = void 0;
      }
      if (row.type === "delayed") {
        return {
          id: row.id,
          callback: row.callback,
          payload,
          type: "delayed",
          time: row.time,
          delayInSeconds: row.delayInSeconds
        };
      } else {
        return {
          id: row.id,
          callback: row.callback,
          payload,
          type: "scheduled",
          time: row.time
        };
      }
    });
  }
  /**
   * Method called when an alarm fires
   * Executes any scheduled tasks that are due
   */
  async alarm() {
    return __privateMethod(this, _Container_instances, tryCatch_fn).call(this, async () => {
      const now = Math.floor(Date.now() / 1e3);
      const result = this.sql`
        SELECT * FROM container_schedules WHERE time <= ${now}
      `;
      for (const row of result) {
        const callback = this[row.callback];
        if (!callback || typeof callback !== "function") {
          console.error(`Callback ${row.callback} not found or is not a function`);
          continue;
        }
        const schedule = this.getSchedule(row.id);
        try {
          const payload = row.payload ? JSON.parse(row.payload) : void 0;
          await containerContext.run(
            {
              container: this,
              connection: void 0,
              request: void 0
            },
            async () => {
              await callback.call(this, payload, await schedule);
            }
          );
        } catch (e) {
          console.error(`Error executing scheduled callback "${row.callback}":`, e);
        }
        this.sql`DELETE FROM container_schedules WHERE id = ${row.id}`;
      }
      await __privateMethod(this, _Container_instances, scheduleNextAlarm_fn).call(this);
    });
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
/**
 * Parse a time expression into seconds
 * @private
 * @param timeExpression Time expression (number or string like "5m", "30s", "1h")
 * @returns Number of seconds
 */
parseTimeExpression_fn = function(timeExpression) {
  if (typeof timeExpression === "number") {
    return timeExpression;
  } else if (typeof timeExpression === "string") {
    const match = timeExpression.match(/^(\d+)([smh])$/);
    if (!match) {
      return 300;
    } else {
      const value = parseInt(match[1]);
      const unit = match[2];
      switch (unit) {
        case "s":
          return value;
        case "m":
          return value * 60;
        case "h":
          return value * 60 * 60;
        default:
          return 300;
      }
    }
  } else {
    return 300;
  }
};
scheduleSleepTimeout_fn = async function() {
  const timeoutInSeconds = __privateMethod(this, _Container_instances, parseTimeExpression_fn).call(this, this.sleepAfter);
  await __privateMethod(this, _Container_instances, cancelSleepTimeout_fn).call(this);
  const { id } = await this.schedule(timeoutInSeconds, "shutdownDueToInactivity");
  __privateSet(this, _sleepTimeoutTaskId, id);
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
scheduleNextAlarm_fn = async function() {
  const result = this.sql`
      SELECT time FROM container_schedules 
      WHERE time > ${Math.floor(Date.now() / 1e3)}
      ORDER BY time ASC 
      LIMIT 1
    `;
  if (result.length > 0 && "time" in result[0]) {
    const nextTime = result[0].time * 1e3;
    await this.ctx.storage.setAlarm(nextTime);
  }
};
/**
 * Default container configuration
 * Configure at class level by overriding in your subclass
 */
Container.containerConfig = {
  env: {},
  enableInternet: true
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
  const objectId = binding.idFromName(`instance-${id}`);
  return binding.get(objectId);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Container,
  getCurrentContainer,
  loadBalance,
  randomContainerId
});
