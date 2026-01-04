import { Module, forwardRef } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [UsersModule, forwardRef(() => AuthModule)],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
