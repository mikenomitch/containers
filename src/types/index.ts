/**
 * Basic types for the container implementation
 */

import type { Party, Connection } from "partykit/server";

/**
 * Message structure for communication with containers
 */
export interface ContainerMessage<T = unknown> {
  type: string;
  payload?: T;
}

/**
 * Container state that is persisted
 */
export interface ContainerState {
  [key: string]: unknown;
}

/**
 * Options for container configuration
 */
export interface ContainerOptions {
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
export interface ContainerContext {
  id: string;
  party: Party;
  request?: Request;
  connection?: Connection;
}

/**
 * Function to handle container events 
 */
export type ContainerEventHandler = (state?: ContainerState) => void | Promise<void>;

