import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateWorkspaceSettingsDto } from './update-workspace.dto';

describe('UpdateWorkspaceSettingsDto', () => {
  describe('allowed_domains validation', () => {
    const validateDomains = async (domains: string[]) => {
      const dto = plainToInstance(UpdateWorkspaceSettingsDto, {
        allowed_domains: domains,
      });
      return validate(dto);
    };

    describe('valid domains', () => {
      it.each([
        ['example.com', 'simple domain'],
        ['sub.example.com', 'subdomain'],
        ['deep.sub.example.com', 'deep subdomain'],
        ['*.example.com', 'wildcard subdomain'],
        ['*.sub.example.com', 'wildcard with subdomain'],
        ['example.co.uk', 'country code TLD'],
        ['example.com.au', 'country code TLD (Australia)'],
        ['*.example.co.uk', 'wildcard with country code TLD'],
        ['my-site.example.com', 'hyphenated subdomain'],
        ['my-company.co.uk', 'hyphenated with country code TLD'],
        ['*.my-company.co.uk', 'wildcard hyphenated with country code TLD'],
        ['a1.example.com', 'alphanumeric subdomain'],
        ['test123.example.com', 'numbers in subdomain'],
        ['example.io', 'short TLD'],
        ['example.travel', 'long TLD'],
        ['example.museum', 'long TLD (museum)'],
        ['sub1.sub2.sub3.example.com', 'multiple subdomains'],
        ['*.sub1.sub2.example.com', 'wildcard with multiple subdomains'],
      ])('accepts %s (%s)', async (domain) => {
        const errors = await validateDomains([domain]);
        expect(errors).toHaveLength(0);
      });

      it('accepts multiple valid domains', async () => {
        const errors = await validateDomains([
          'example.com',
          '*.example.org',
          'sub.example.co.uk',
        ]);
        expect(errors).toHaveLength(0);
      });

      it('accepts empty array (no restrictions)', async () => {
        const errors = await validateDomains([]);
        expect(errors).toHaveLength(0);
      });
    });

    describe('invalid domains', () => {
      it.each([
        ['toto', 'single word without TLD'],
        ['localhost', 'localhost without TLD'],
        ['example', 'domain without TLD'],
        ['.example.com', 'leading dot'],
        ['example.', 'trailing dot'],
        ['example..com', 'double dot'],
        ['*.', 'wildcard only with dot'],
        ['*', 'wildcard only'],
        ['**example.com', 'double asterisk'],
        ['*example.com', 'asterisk without dot'],
        ['exam*ple.com', 'asterisk in middle'],
        ['example.c', 'single char TLD'],
        ['-example.com', 'leading hyphen'],
        ['example-.com', 'trailing hyphen in subdomain'],
        ['example.com/path', 'with path'],
        ['https://example.com', 'with protocol'],
        ['example.com:8080', 'with port'],
        ['user@example.com', 'email format'],
        ['exam ple.com', 'space in domain'],
        ['example_.com', 'underscore in subdomain'],
        ['192.168.1.1', 'IP address'],
      ])('rejects %s (%s)', async (domain) => {
        const errors = await validateDomains([domain]);
        expect(errors).toHaveLength(1);
        expect(errors[0].constraints?.matches).toContain(
          'Each domain must be a valid domain',
        );
      });

      it('rejects when one domain in array is invalid', async () => {
        const errors = await validateDomains([
          'example.com',
          'invalid',
          '*.example.org',
        ]);
        expect(errors).toHaveLength(1);
        expect(errors[0].constraints?.matches).toContain(
          'Each domain must be a valid domain',
        );
      });
    });

    describe('edge cases', () => {
      it('accepts undefined (optional field)', async () => {
        const dto = plainToInstance(UpdateWorkspaceSettingsDto, {});
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it('accepts domain with max length (253 chars)', async () => {
        // Build a valid domain close to 253 chars
        const longSubdomain = 'a'.repeat(63); // max label length
        const domain = `${longSubdomain}.${longSubdomain}.${longSubdomain}.example.com`;
        const errors = await validateDomains([domain]);
        expect(errors).toHaveLength(0);
      });

      it('rejects domain exceeding max length', async () => {
        const tooLong = 'a'.repeat(250) + '.com';
        const errors = await validateDomains([tooLong]);
        expect(errors).toHaveLength(1);
      });
    });
  });
});
