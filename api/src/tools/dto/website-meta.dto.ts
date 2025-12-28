import { IsUrl } from 'class-validator';

export class WebsiteMetaDto {
  @IsUrl()
  url: string;
}

export interface WebsiteMetaResponse {
  title?: string;
  logo_url?: string;
}
