import { MajorMigration } from './migration.interface';
import { V3Migration } from './versions/v3.migration';

/**
 * Registry of all major migrations.
 * Add new migrations here in version order.
 */
export const MIGRATIONS: MajorMigration[] = [new V3Migration()];
