import { Controller, HttpCode, Post } from '@nestjs/common';
import { DemoService } from './demo.service';
import { DemoProtected } from './decorators/demo-protected.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('api')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Post('demo.generate')
  @Public() // Bypass JWT auth
  @DemoProtected() // Use demo secret auth
  async generate() {
    return this.demoService.generate();
  }

  @Post('demo.delete')
  @Public()
  @DemoProtected()
  @HttpCode(200)
  async delete() {
    return this.demoService.delete();
  }
}
