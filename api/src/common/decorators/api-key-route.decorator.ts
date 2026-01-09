import { SetMetadata } from '@nestjs/common';

export const IS_API_KEY_ROUTE = 'isApiKeyRoute';
export const ApiKeyRoute = () => SetMetadata(IS_API_KEY_ROUTE, true);
