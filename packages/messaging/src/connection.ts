import { EventEmitter } from 'node:events';
import { connect, type ChannelModel } from 'amqplib';
import type { Logger } from '@cip/observability';

export type SetupFn = (model: ChannelModel) => Promise<void>;

export interface AmqpClientOptions {
  url: string;
  name: string;
  logger?: Logger;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export class AmqpClient extends EventEmitter {
  private model: ChannelModel | null = null;
  private readonly setups: SetupFn[] = [];
  private closing = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private readonly options: AmqpClientOptions) {
    super();
  }

  get connected(): boolean {
    return this.model !== null;
  }

  get current(): ChannelModel | null {
    return this.model;
  }

  onConnect(setup: SetupFn): void {
    this.setups.push(setup);
    if (this.model) void setup(this.model).catch((error: unknown) => this.handleSetupError(error));
  }

  async start(options: { waitForConnection?: boolean } = {}): Promise<void> {
    this.closing = false;
    const first = this.connectOnce();
    if (options.waitForConnection) await first;
    else void first.catch(() => undefined);
  }

  async waitForConnection(timeoutMs = 10000): Promise<void> {
    if (this.model) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('connected', onConnected);
        reject(new Error('timed out waiting for RabbitMQ'));
      }, timeoutMs);
      const onConnected = () => {
        clearTimeout(timer);
        resolve();
      };
      this.once('connected', onConnected);
    });
  }

  private connectOnce(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        const model = await connect(this.options.url, {
          clientProperties: { connection_name: this.options.name },
        });
        model.on('error', (error: Error) =>
          this.options.logger?.warn({ err: error }, 'amqp connection error'),
        );
        model.on('close', () => this.handleClose(model));
        model.on('blocked', (reason: string) =>
          this.options.logger?.warn({ reason }, 'amqp connection blocked'),
        );
        this.model = model;
        this.attempt = 0;
        for (const setup of this.setups) await setup(model);
        this.options.logger?.info({ name: this.options.name }, 'amqp connected');
        this.emit('connected', model);
      } catch (error) {
        if (this.model) {
          const model = this.model;
          this.model = null;
          await model.close().catch(() => undefined);
        }
        this.options.logger?.warn({ err: error }, 'amqp connect failed');
        this.scheduleReconnect();
        throw error;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  private handleSetupError(error: unknown): void {
    this.options.logger?.error({ err: error }, 'amqp setup failed');
  }

  private handleClose(model: ChannelModel): void {
    if (this.model !== model) return;
    this.model = null;
    this.emit('disconnected');
    if (!this.closing) {
      this.options.logger?.warn('amqp connection closed, reconnecting');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.timer) return;
    this.attempt += 1;
    const base = this.options.reconnectDelayMs ?? 500;
    const max = this.options.maxReconnectDelayMs ?? 10000;
    const delay = Math.min(max, base * 2 ** Math.min(this.attempt - 1, 8)) * (0.75 + Math.random() * 0.5);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connectOnce().catch(() => undefined);
    }, delay);
    this.timer.unref();
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const model = this.model;
    this.model = null;
    if (model) await model.close().catch(() => undefined);
  }
}
