import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateSubscriptionDto,
  AVAILABLE_METRICS,
  AVAILABLE_DIMENSIONS,
} from './create-subscription.dto';

describe('CreateSubscriptionDto', () => {
  const validDto = {
    workspace_id: 'ws-1',
    name: 'Test Report',
    frequency: 'daily',
    metrics: ['sessions'],
  };

  describe('metrics validation', () => {
    it('should accept valid metrics', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        metrics: ['sessions', 'median_duration'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept all available metrics', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        metrics: [...AVAILABLE_METRICS],
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject invalid metric', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        metrics: ['invalid_metric'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('metrics');
    });

    it('should reject mix of valid and invalid metrics', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        metrics: ['sessions', 'invalid_metric'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('metrics');
    });

    it('should reject empty metrics array', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        metrics: [],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject missing metrics', async () => {
      const { metrics, ...dtoWithoutMetrics } = validDto;
      const dto = plainToInstance(CreateSubscriptionDto, dtoWithoutMetrics);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('dimensions validation', () => {
    it('should accept valid dimensions', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        dimensions: ['landing_path', 'country'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept all available dimensions', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        dimensions: [...AVAILABLE_DIMENSIONS],
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject invalid dimension', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        dimensions: ['invalid_dimension'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('dimensions');
    });

    it('should reject mix of valid and invalid dimensions', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        dimensions: ['country', 'invalid_dimension'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('dimensions');
    });

    it('should allow empty dimensions array', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
        dimensions: [],
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should allow missing dimensions (optional field)', async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...validDto,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
