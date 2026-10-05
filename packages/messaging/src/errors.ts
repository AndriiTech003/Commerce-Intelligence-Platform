export class PoisonMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoisonMessageError';
  }
}

export class UnroutableMessageError extends Error {
  constructor(
    readonly exchange: string,
    readonly routingKey: string,
  ) {
    super(`Message to ${exchange} with routing key ${routingKey} was returned as unroutable`);
    this.name = 'UnroutableMessageError';
  }
}

export class BrokerUnavailableError extends Error {
  constructor(message = 'Message broker is not connected') {
    super(message);
    this.name = 'BrokerUnavailableError';
  }
}

export type ErrorKind = 'poison' | 'retryable';

export function defaultClassifyError(error: unknown): ErrorKind {
  if (error instanceof PoisonMessageError) return 'poison';
  if (error && typeof error === 'object' && (error as { name?: string }).name === 'ZodError') return 'poison';
  return 'retryable';
}
