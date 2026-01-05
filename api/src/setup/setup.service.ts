import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { generateId, hashPassword } from '../common/crypto';
import { User } from '../common/entities';
import { toClickHouseDateTime } from '../common/utils/datetime.util';

@Injectable()
export class SetupService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async isSetupComplete(): Promise<boolean> {
    const result = await this.clickhouse.querySystem<{ value: string }>(
      `
      SELECT value FROM system_settings FINAL
      WHERE key = 'setup_completed'
      LIMIT 1
    `,
    );

    return result[0]?.value === 'true';
  }

  async markSetupComplete(): Promise<void> {
    const now = toClickHouseDateTime();

    await this.clickhouse.insertSystem('system_settings', [
      {
        key: 'setup_completed',
        value: 'true',
        updated_at: now,
      },
    ]);
  }

  async createInitialAdmin(
    email: string,
    password: string,
    name: string,
  ): Promise<{
    access_token: string;
    user: { id: string; email: string; name: string; is_super_admin: boolean };
  }> {
    // Check if setup is already complete
    if (await this.isSetupComplete()) {
      throw new BadRequestException('Setup has already been completed');
    }

    // Check if any users already exist
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new BadRequestException('A user with this email already exists');
    }

    // Create the admin user
    const id = generateId();
    const passwordHash = await hashPassword(password);
    const now = toClickHouseDateTime();

    const user: User = {
      id,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      name,
      type: 'user',
      status: 'active',
      is_super_admin: true,
      last_login_at: now,
      failed_login_attempts: 0,
      locked_until: null,
      password_changed_at: now,
      deleted_at: null,
      deleted_by: null,
      created_at: now,
      updated_at: now,
    };

    await this.clickhouse.insertSystem('users', [user]);

    // Mark setup as complete
    await this.markSetupComplete();

    // Generate JWT token
    const payload = {
      sub: user.id,
      email: user.email,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      access_token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        is_super_admin: user.is_super_admin,
      },
    };
  }
}
