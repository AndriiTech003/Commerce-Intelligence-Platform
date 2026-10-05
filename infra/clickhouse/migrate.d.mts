export function splitStatements(sql: string): string[];
export function migrateClickHouse(options?: {
  url?: string;
  database?: string;
  log?: (message: string) => void;
}): Promise<string[]>;
export function dropClickHouseDatabase(options: { url?: string; database: string }): Promise<void>;
