export const DLQ_ADMIN = Symbol('DLQ_ADMIN');

export interface DlqPort {
  list(): Promise<Array<{ queue: string; source: string; messages: number }>>;
  peek(
    queue: string,
    limit: number,
  ): Promise<
    Array<{
      messageId: string;
      routingKey: string;
      exchange: string;
      headers: Record<string, unknown>;
      error: string | null;
      retryCount: number;
      body: unknown;
    }>
  >;
  replay(queue: string, ids: string[] | 'all'): Promise<{ replayed: number; remaining: number }>;
}
