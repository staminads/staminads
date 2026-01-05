import { ApiProperty } from '@nestjs/swagger';

export class BackfillSuccessResponseDto {
  @ApiProperty({ example: true })
  success: boolean;
}

export class BackfillStartResponseDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'The unique identifier for the backfill task',
  })
  task_id: string;
}
