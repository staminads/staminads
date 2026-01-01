import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { SYSTEM_SCHEMAS, WORKSPACE_SCHEMAS } from './schemas';

@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private client: ClickHouseClient;
  private systemDatabase: string;

  constructor(private configService: ConfigService) {
    this.systemDatabase = this.configService.get<string>(
      'CLICKHOUSE_SYSTEM_DATABASE',
      'staminads_system',
    );
    // Create client without default database - we'll use fully qualified names
    this.client = createClient({
      url: this.configService.get<string>(
        'CLICKHOUSE_HOST',
        'http://localhost:8123',
      ),
      username: this.configService.get<string>('CLICKHOUSE_USER', 'default'),
      password: this.configService.get<string>('CLICKHOUSE_PASSWORD', ''),
    });
  }

  async onModuleInit() {
    await this.initSystemDatabase();
  }

  async onModuleDestroy() {
    await this.client.close();
  }

  /**
   * Initialize the system database and its tables.
   */
  private async initSystemDatabase() {
    // Create system database if not exists
    await this.client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${this.systemDatabase}`,
    });

    // Create all system tables
    for (const schema of Object.values(SYSTEM_SCHEMAS)) {
      const query = schema.replace(/{database}/g, this.systemDatabase);
      await this.client.command({ query });
    }
  }

  /**
   * Get the database name for a workspace.
   * Sanitizes the workspace ID for safe use as a database name.
   */
  getWorkspaceDatabaseName(workspaceId: string): string {
    // Replace any characters that aren't alphanumeric or underscore with underscore
    // ClickHouse doesn't allow hyphens in database names
    const sanitized = workspaceId.replace(/[^a-zA-Z0-9_]/g, '_');
    return `staminads_ws_${sanitized}`;
  }

  /**
   * Create a workspace database and its tables.
   */
  async createWorkspaceDatabase(workspaceId: string): Promise<void> {
    const dbName = this.getWorkspaceDatabaseName(workspaceId);

    // Create workspace database
    await this.client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${dbName}`,
    });

    // Create all workspace tables
    for (const schema of Object.values(WORKSPACE_SCHEMAS)) {
      const query = schema.replace(/{database}/g, dbName);
      await this.client.command({ query });
    }
  }

  /**
   * Drop a workspace database (cascade deletes all tables).
   */
  async dropWorkspaceDatabase(workspaceId: string): Promise<void> {
    const dbName = this.getWorkspaceDatabaseName(workspaceId);
    await this.client.command({
      query: `DROP DATABASE IF EXISTS ${dbName}`,
    });
  }

  /**
   * Query the system database.
   * Note: SQL should use unqualified table names (e.g., 'workspaces' not 'database.workspaces').
   * Tables are automatically qualified with the system database name.
   */
  async querySystem<T>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    // Replace unqualified table names with fully qualified names
    const qualifiedSql = this.qualifyTableNames(sql, this.systemDatabase);
    const result = await this.client.query({
      query: qualifiedSql,
      query_params: params,
      format: 'JSONEachRow',
    });
    return result.json() as Promise<T[]>;
  }

  /**
   * Query global ClickHouse tables (e.g., system.mutations) without table name qualification.
   * Use this for querying ClickHouse system tables that exist outside of workspace databases.
   */
  async queryGlobal<T>(
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

  /**
   * Query a workspace database.
   * Note: SQL should use unqualified table names (e.g., 'sessions' not 'database.sessions').
   * Tables are automatically qualified with the workspace database name.
   */
  async queryWorkspace<T>(
    workspaceId: string,
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const dbName = this.getWorkspaceDatabaseName(workspaceId);
    // Replace unqualified table names with fully qualified names
    const qualifiedSql = this.qualifyTableNames(sql, dbName);
    const result = await this.client.query({
      query: qualifiedSql,
      query_params: params,
      format: 'JSONEachRow',
    });
    return result.json() as Promise<T[]>;
  }

  /**
   * Qualify table names in SQL with the given database name.
   * This is a simple replacement for common table patterns.
   */
  private qualifyTableNames(sql: string, database: string): string {
    // Replace FROM table with FROM database.table
    // Replace INTO table with INTO database.table
    // Handle common patterns: FROM, INTO, UPDATE (at start), ALTER TABLE
    // Note: Don't replace UPDATE after ALTER TABLE (e.g., ALTER TABLE x UPDATE col = ...)
    return sql
      .replace(/\bFROM\s+(\w+)\b/gi, `FROM ${database}.$1`)
      .replace(/\bINTO\s+(\w+)\b/gi, `INTO ${database}.$1`)
      // Only match UPDATE at the start of the statement (standalone UPDATE table SET...)
      .replace(/^(\s*)UPDATE\s+(\w+)\b/gi, `$1UPDATE ${database}.$2`)
      .replace(/\bALTER\s+TABLE\s+(\w+)\b/gi, `ALTER TABLE ${database}.$1`);
  }

  /**
   * Insert into a system database table.
   */
  async insertSystem<T>(table: string, values: T[]): Promise<void> {
    await this.client.insert({
      table: `${this.systemDatabase}.${table}`,
      values: values as Record<string, unknown>[],
      format: 'JSONEachRow',
    });
  }

  /**
   * Insert into a workspace database table.
   */
  async insertWorkspace<T>(
    workspaceId: string,
    table: string,
    values: T[],
  ): Promise<void> {
    const dbName = this.getWorkspaceDatabaseName(workspaceId);
    await this.client.insert({
      table: `${dbName}.${table}`,
      values: values as Record<string, unknown>[],
      format: 'JSONEachRow',
    });
  }

  /**
   * Execute a command on the system database.
   */
  async commandSystem(sql: string): Promise<void> {
    // Replace {database} placeholder if present
    let finalSql = sql.replace(/{database}/g, this.systemDatabase);
    // Qualify unqualified table names
    finalSql = this.qualifyTableNames(finalSql, this.systemDatabase);
    await this.client.command({ query: finalSql });
  }

  /**
   * Execute a command on a workspace database.
   */
  async commandWorkspace(workspaceId: string, sql: string): Promise<void> {
    const dbName = this.getWorkspaceDatabaseName(workspaceId);
    // Replace {database} placeholder if present
    let finalSql = sql.replace(/{database}/g, dbName);
    // Qualify unqualified table names
    finalSql = this.qualifyTableNames(finalSql, dbName);
    await this.client.command({ query: finalSql });
  }

  /**
   * Execute a parameterized command on a workspace database.
   * Use this for commands with dynamic values to avoid SQL injection.
   */
  async commandWorkspaceWithParams(
    workspaceId: string,
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const dbName = this.getWorkspaceDatabaseName(workspaceId);
    // Replace {database} placeholder if present
    let finalSql = sql.replace(/{database}/g, dbName);
    // Qualify unqualified table names
    finalSql = this.qualifyTableNames(finalSql, dbName);
    await this.client.command({
      query: finalSql,
      query_params: params,
    });
  }

  // ============================================
  // Legacy methods for backward compatibility
  // These will be removed after migration
  // ============================================

  /**
   * @deprecated Use querySystem or queryWorkspace instead
   */
  async query<T>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    return this.querySystem<T>(sql, params);
  }

  /**
   * @deprecated Use insertSystem or insertWorkspace instead
   */
  async insert<T>(table: string, values: T[]): Promise<void> {
    return this.insertSystem<T>(table, values);
  }

  /**
   * @deprecated Use commandSystem or commandWorkspace instead
   */
  async command(sql: string): Promise<void> {
    return this.commandSystem(sql);
  }
}
