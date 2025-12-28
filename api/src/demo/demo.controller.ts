import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoService } from './demo.service';
import { DemoProtected } from './decorators/demo-protected.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('demo')
@Controller('api')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Post('demo.generate')
  @Public()
  @DemoProtected()
  @ApiOperation({ summary: 'Generate demo fixtures (10k sessions)' })
  async generate() {
    return this.demoService.generate();
  }

  @Post('demo.delete')
  @Public()
  @DemoProtected()
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete demo workspace and sessions' })
  async delete() {
    return this.demoService.delete();
  }
}
