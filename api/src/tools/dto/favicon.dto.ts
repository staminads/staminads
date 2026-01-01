import { IsUrl } from 'class-validator';

export class FaviconQueryDto {
  @IsUrl()
  url: string;
}

export interface FaviconResult {
  buffer: Buffer;
  contentType: string;
}
