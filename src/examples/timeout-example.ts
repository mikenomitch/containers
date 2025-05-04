import { Container } from '../lib/container';
import type { ContainerState } from '../types';

/**
 * Example implementation of a Container with custom timeout settings
 */
export class TimeoutContainer extends Container {
  // Configure default port for the container
  defaultPort = 8080;

  // Customize the sleep timeout to 30 minutes
  sleepAfter = "30m";

  // Sample initial state with timestamp
  initialState = {
    startedAt: Date.now(),
    activityCount: 0
  };

  constructor(ctx: any, env: any) {
    super(ctx, env);
  }

  // Lifecycle method called when container boots
  override onBoot(state?: ContainerState): void {
    console.log('Container booted with timeout set to:', this.sleepAfter);
  }

  // Lifecycle method called when container shuts down
  override onShutdown(state?: ContainerState): void {
    console.log('Container shutdown. Activity count:', state?.activityCount);
  }

  // Custom method that will renew the activity timeout
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
    
    // This will renew the activity timeout
    await this.renewActivityTimeout();
    
    console.log('Background task completed, activity timeout renewed');
  }

  // Handle incoming HTTP requests
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Example endpoint to trigger background task
    if (url.pathname === '/task') {
      const taskData = { 
        id: Date.now().toString(),
        type: 'manual' 
      };
      
      await this.performBackgroundTask(taskData);
      
      return new Response(JSON.stringify({
        success: true,
        message: 'Background task executed',
        nextShutdown: `Container will shut down after ${this.sleepAfter} of inactivity`
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Endpoint to view timeout status
    if (url.pathname === '/timeout-status') {
      return new Response(JSON.stringify({
        sleepAfter: this.sleepAfter,
        state: this.state
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Update state to track HTTP requests
    const currentState = this.state;
    this.setState({
      ...currentState,
      activityCount: (currentState.activityCount as number || 0) + 1,
      lastActivity: {
        type: 'http',
        timestamp: Date.now(),
        path: url.pathname
      }
    });
    
    // For all other requests, proxy to the container
    // This will automatically renew the activity timeout
    return await this.proxyRequest(request);
  }
}