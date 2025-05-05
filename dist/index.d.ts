import { Party, Connection } from 'partyserver';

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
 * Represents a scheduled task within a Container
 * @template T Type of the payload data
 */
type Schedule<T = string> = {
    /** Unique identifier for the schedule */
    id: string;
    /** Name of the method to be called */
    callback: string;
    /** Data to be passed to the callback */
    payload: T;
} & ({
    /** Type of schedule for one-time execution at a specific time */
    type: "scheduled";
    /** Timestamp when the task should execute */
    time: number;
} | {
    /** Type of schedule for delayed execution */
    type: "delayed";
    /** Timestamp when the task should execute */
    time: number;
    /** Number of seconds to delay execution */
    delayInSeconds: number;
});

/**
 * Helper function to get the current container context
 */
declare function getCurrentContainer<T extends Container = Container>(): {
    container: T | undefined;
    connection: Connection | undefined;
    request: Request | undefined;
};
declare const Container_base: any;
/**
 * Main Container class that wraps PartyKit's Server with container functionality
 */
declare class Container<Env = unknown> extends Container_base {
    #private;
    defaultPort?: number;
    sleepAfter: string | number;
    explicitContainerStart: boolean;
    /**
     * Default container configuration
     * Configure at class level by overriding in your subclass
     */
    static containerConfig: {
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
     * Schedule a task to be executed in the future
     * @template T Type of the payload data
     * @param when When to execute the task (Date object or number of seconds delay)
     * @param callback Name of the method to call
     * @param payload Data to pass to the callback
     * @returns Schedule object representing the scheduled task
     */
    schedule<T = string>(when: Date | number, callback: keyof this, payload?: T): Promise<Schedule<T>>;
    /**
     * Cancel a scheduled task
     * @param id ID of the task to cancel
     * @returns true if the task was cancelled, false if not found
     */
    unschedule(id: string): Promise<boolean>;
    /**
     * Get a scheduled task by ID
     * @template T Type of the payload data
     * @param id ID of the scheduled task
     * @returns The Schedule object or undefined if not found
     */
    getSchedule<T = string>(id: string): Promise<Schedule<T> | undefined>;
    /**
     * Get scheduled tasks matching the given criteria
     * @template T Type of the payload data
     * @param criteria Criteria to filter schedules
     * @returns Array of matching Schedule objects
     */
    getSchedules<T = string>(criteria?: {
        id?: string;
        type?: 'scheduled' | 'delayed';
        timeRange?: {
            start?: Date;
            end?: Date;
        };
    }): Schedule<T>[];
    /**
     * Method called when an alarm fires
     * Executes any scheduled tasks that are due
     */
    alarm(): Promise<void>;
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
