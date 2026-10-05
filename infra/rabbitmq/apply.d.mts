export interface TopologyOptions {
  managementUrl?: string;
  user?: string;
  pass?: string;
  vhost?: string;
}
export function loadDefinitions(): {
  queues: Array<{ name: string; arguments: Record<string, unknown> }>;
  exchanges: Array<{ name: string; type: string }>;
  bindings: Array<{ source: string; destination: string; routing_key: string }>;
};
export function applyTopology(options?: TopologyOptions): Promise<string>;
export function deleteVhost(options: TopologyOptions & { vhost: string }): Promise<void>;
export function amqpUrlFor(vhost: string, base?: string): string;
