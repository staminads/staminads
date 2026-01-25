import { SetMetadata } from '@nestjs/common';

/**
 * Marks an endpoint as JWT-only, rejecting API key authentication.
 *
 * Use this for user-scoped operations that don't make sense with API keys:
 * - users.me (user profile)
 * - apiKeys.list/get/revoke (managing API keys via API key is circular)
 * - members.leave (a key can't "leave" a workspace)
 * - members.transferOwnership (a key can't "transfer" ownership)
 */
export const JWT_ONLY_KEY = 'jwtOnly';
export const JwtOnly = () => SetMetadata(JWT_ONLY_KEY, true);
