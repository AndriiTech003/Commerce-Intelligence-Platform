export interface Stack {
  env: Record<string, string>;
  ports: Record<string, number>;
  name: string;
}
export function stackEnv(profile: string, id: string): Stack;
export function provision(stack: Stack): Promise<void>;
export function teardown(stack: Stack): Promise<void>;
export interface StackService {
  name: string;
  cmd: string[] | ((ports: Record<string, number>) => string[]);
  health: (ports: Record<string, number>) => string;
  healthMethod?: string;
}
export const SERVICES: StackService[];
export function waitHealthy(url: string, timeoutMs?: number): Promise<void>;
