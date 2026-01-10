import { MajorMigration } from './migration.interface';
import { V4ResetMigration } from './v4-reset-migration';

/**
 * Registry of all major migrations.
 * Add new migrations here in version order.
 */
export const MIGRATIONS: MajorMigration[] = [V4ResetMigration];
