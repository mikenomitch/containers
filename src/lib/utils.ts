/**
 * Utility functions for container operations
 */

import type { Container } from "./container";

/**
 * Randomly select a container ID from a range for load balancing
 * @param max Maximum container ID (exclusive)
 * @returns A random integer between 0 and max-1
 */
export function randomContainerId(max: number): number {
  return Math.floor(Math.random() * max);
}

/**
 * Load balance requests across multiple container instances
 * @param binding The Container binding
 * @param instances Number of instances to load balance across
 * @returns A container stub ready to handle requests
 */
export async function loadBalance<T extends Container>(
  binding: DurableObjectNamespace, 
  instances: number = 3
): Promise<DurableObjectStub> {
  // Generate a random ID within the range of instances
  const id = randomContainerId(instances).toString();
  
  // Get the Durable Object ID for this instance
  const objectId = binding.idFromString(id);
  
  // Return the stub for the selected instance
  return binding.get(objectId);
}