import type { ServerResponse } from 'node:http';

const ONE_YEAR_IN_SECONDS = 31_536_000;
const VERSIONED_SDK_PATTERN = /[\\/]sdk[\\/]staminads_\d+\.\d+\.\d+\.min\.js$/;

export function setStaticAssetHeaders(
  response: ServerResponse,
  filePath: string,
): void {
  if (VERSIONED_SDK_PATTERN.test(filePath)) {
    response.setHeader(
      'Cache-Control',
      `public, max-age=${ONE_YEAR_IN_SECONDS}, immutable`,
    );
  }
}
