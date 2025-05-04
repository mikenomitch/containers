import { Party, Connection, Server } from 'partykit/server';

/**
 * Basic types for the container implementation
 */

/**
 * Message structure for communication with containers
 */
interface ContainerMessage<T = unknown> {
    type: string;
    payload?: T;
}
/**
 * Container state that is persisted
 */
interface ContainerState {
    [key: string]: unknown;
}
/**
 * Options for container configuration
 */
interface ContainerOptions {
    /** Optional ID for the container */
    id?: string;
    /** Default port number to connect to (defaults to container.defaultPort) */
    defaultPort?: number;
    /** How long to keep the container alive without activity */
    sleepAfter?: string | number;
    /** Environment variables to pass to the container */
    env?: Record<string, string>;
    /** Custom entrypoint to override container default */
    entrypoint?: string[];
    /** Whether to enable internet access for the container */
    enableInternet?: boolean;
    /** If true, container won't be started automatically when the durable object boots */
    explicitContainerStart?: boolean;
}
/**
 * Context provided to container methods
 */
interface ContainerContext {
    id: string;
    party: Party;
    request?: Request;
    connection?: Connection;
}
/**
 * Function to handle container events
 */
type ContainerEventHandler = (state?: ContainerState) => void | Promise<void>;

/**
 * Helper function to get the current container context
 */
declare function getCurrentContainer<T extends Container = Container>(): {
    container: T | undefined;
    connection: Connection | undefined;
    request: Request | undefined;
};
/**
 * Main Container class that wraps PartyKit's Server with container functionality
 */
declare class Container<Env = unknown> extends Server<Env> {
    #private;
    defaultPort?: number;
    sleepAfter: string | number;
    explicitContainerStart: boolean;
    containerConfig: {
        env?: Record<string, string>;
        entrypoint?: string[];
        enableInternet?: boolean;
    };
    /**
     * Initial state for the Container
     */
    initialState: ContainerState;
    /**
     * Current state of the Container
     */
    get state(): ContainerState;
    /**
     * Container configuration options
     */
    static options: {
        hibernate: boolean;
    };
    /**
     * Execute SQL queries against the Container's database
     */
    sql<T = Record<string, string | number | boolean | null>>(strings: TemplateStringsArray, ...values: (string | number | boolean | null)[]): T[];
    constructor(ctx: any, env: Env, options?: ContainerOptions);
    /**
     * Determine if container should auto-start
     */
    shouldAutoStart(): boolean;
    /**
     * Start the container and wait for a port to be available (if port is specified)
     * Based on containers-starter-go implementation
     */
    startAndWaitForPort(port?: number, maxTries?: number): Promise<void>;
    /**
     * Proxy an HTTP request to the container
     * Based on containers-starter-go implementation
     */
    proxyRequest(request: Request, port?: number): Promise<Response>;
    /**
     * Shuts down the container
     */
    shutdownContainer(reason?: string): Promise<void>;
    /**
     * Update the container's state
     */
    setState(state: ContainerState): void;
    /**
     * Lifecycle method called when container boots successfully
     * Override this method in subclasses to handle container boot events
     */
    onBoot(state?: ContainerState): void | Promise<void>;
    /**
     * Lifecycle method called when container shuts down
     * Override this method in subclasses to handle container shutdown events
     */
    onShutdown(state?: ContainerState): void | Promise<void>;
    /**
     * Lifecycle method called when container state is updated
     * Override this method in subclasses to handle state changes
     */
    onStateUpdate(state: ContainerState): void | Promise<void>;
    /**
     * Error handler for container errors
     * Override this method in subclasses to handle container errors
     */
    onError(error: unknown): any;
    /**
     * Renew the container's activity timeout
     * Call this method whenever there is activity on the container
     */
    renewActivityTimeout(): Promise<void>;
    /**
     * Method called by scheduled task to shutdown the container due to inactivity
     */
    shutdownDueToInactivity(): Promise<void>;
    /**
     * Proxy a WebSocket connection to the container
     * @param request The WebSocket upgrade request
     * @param port The port to connect to (defaults to this.defaultPort if not specified)
     * @returns A Response with webSocket set to handle the upgrade
     */
    proxyWebSocket(request: Request, port?: number): Promise<Response>;
    /**
     * Handle fetch requests to the Container
     * Default implementation proxies HTTP requests to the container
     * Override this in your subclass to specify a port or implement custom request handling
     */
    fetch(request: Request): Promise<Response>;
}

/**
 * Utility functions for container operations
 */

/**
 * Randomly select a container ID from a range for load balancing
 * @param max Maximum container ID (exclusive)
 * @returns A random integer between 0 and max-1
 */
declare function randomContainerId(max: number): number;
/**
 * Load balance requests across multiple container instances
 * @param binding The Container binding
 * @param instances Number of instances to load balance across
 * @returns A container stub ready to handle requests
 */
declare function loadBalance<T extends Container>(binding: DurableObjectNamespace, instances?: number): Promise<DurableObjectStub>;

export { Container, type ContainerContext, type ContainerEventHandler, type ContainerMessage, type ContainerOptions, type ContainerState, getCurrentContainer, loadBalance, randomContainerId };
