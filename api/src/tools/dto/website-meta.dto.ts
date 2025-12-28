import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class WebsiteMetaDto {
  @IsUrl()
  url: string;
}

export class WebsiteMetaResponse {
  @ApiProperty({ description: 'Website title', required: false })
  title?: string;

  @ApiProperty({ description: 'Website logo URL', required: false })
  logo_url?: string;
}
