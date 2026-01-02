import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  HttpCode,
  Header,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AssistantService } from './assistant.service';
import { ChatRequestDto, ChatJobResponse } from './dto/chat.dto';

@ApiTags('assistant')
@ApiSecurity('jwt-auth')
@Controller('api')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('assistant.chat')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create an AI assistant chat job',
    description:
      'Creates a new chat job and returns a job ID. Use the stream endpoint to get results.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job created successfully',
    schema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job ID for streaming' },
      },
    },
  })
  async chat(@Body() dto: ChatRequestDto): Promise<ChatJobResponse> {
    return this.assistantService.createJob(dto);
  }

  @Get('assistant.stream/:jobId')
  @ApiOperation({
    summary: 'Stream AI assistant results via SSE',
    description:
      'Streams thinking text and tool calls, then emits final config. Supports reconnection.',
  })
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  async stream(
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    await this.assistantService.streamJob(jobId, res);
  }
}
