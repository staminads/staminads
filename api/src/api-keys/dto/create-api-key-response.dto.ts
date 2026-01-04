import { PublicApiKey } from '../../common/entities/api-key.entity';

/**
 * Response for creating an API key.
 * Contains the full key (ONLY returned once) and the public key metadata.
 */
export class CreateApiKeyResponseDto {
  /**
   * The full API key. This is ONLY returned once and is not stored.
   * Format: sk_live_<64 hex chars>
   */
  key: string;

  /**
   * Public API key metadata (without the key_hash)
   */
  apiKey: PublicApiKey;
}
