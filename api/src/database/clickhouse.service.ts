import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { SCHEMAS } from './schemas';

@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private client: ClickHouseClient;
  private database: string;

  constructor(private configService: ConfigService) {
    this.database = this.configService.get<string>(
      'CLICKHOUSE_DATABASE',
      'staminads',
    );
    this.client = createClient({
      url: this.configService.get<string>(
        'CLICKHOUSE_HOST',
        'http://localhost:8123',
      ),
      username: this.configService.get<string>('CLICKHOUSE_USER', 'default'),
      password: this.configService.get<string>('CLICKHOUSE_PASSWORD', ''),
      database: this.database,
    });
  }

  async onModuleInit() {
    await this.initDatabase();
  }

  async onModuleDestroy() {
    await this.client.close();
  }

  private async initDatabase() {
    // Create database if not exists
    await this.client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${this.database}`,
    });

    // Create all tables from schemas
    for (const schema of Object.values(SCHEMAS)) {
      const query = schema.replace(/{database}/g, this.database);
      await this.client.command({ query });
    }
  }

  async query<T>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const result = await this.client.query({
      query: sql,
      query_params: params,
      format: 'JSONEachRow',
    });
    return result.json() as Promise<T[]>;
  }

  async insert<T>(table: string, values: T[]): Promise<void> {
    await this.client.insert({
      table,
      values: values as Record<string, unknown>[],
      format: 'JSONEachRow',
    });
  }

  async command(sql: string): Promise<void> {
    await this.client.command({ query: sql });
  }
}
