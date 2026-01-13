import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ReportGeneratorService } from './report-generator.service';
import { AnalyticsService } from '../../analytics/analytics.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { UsersService } from '../../users/users.service';
import { Subscription } from '../entities/subscription.entity';

describe('ReportGeneratorService', () => {
  let service: ReportGeneratorService;
  let analyticsService: jest.Mocked<AnalyticsService>;
  let workspacesService: jest.Mocked<WorkspacesService>;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  const mockWorkspace = {
    id: 'ws-123',
    name: 'Test Workspace',
    website: 'https://example.com',
    logo_url: 'https://example.com/logo.png',
    timezone: 'America/New_York',
    currency: 'USD',
    status: 'active',
    settings: '{}',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    type: 'user',
    status: 'active',
    is_super_admin: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  const mockSubscription: Subscription = {
    id: 'sub-123',
    user_id: 'user-123',
    workspace_id: 'ws-123',
    name: 'Daily Report',
    frequency: 'daily',
    hour: 8,
    metrics: ['sessions', 'median_duration'],
    dimensions: ['landing_path', 'device'],
    filters: '[]',
    status: 'active',
    last_send_status: 'pending',
    last_error: '',
    consecutive_failures: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  const mockMetricsResponse = {
    data: {
      current: [{ sessions: 100, median_duration: 45000 }],
      previous: [{ sessions: 90, median_duration: 40000 }],
    },
    meta: {
      metrics: ['sessions', 'median_duration'],
      dimensions: [],
      dateRange: { start: '2024-01-01', end: '2024-01-01' },
      compareDateRange: { start: '2023-12-31', end: '2023-12-31' },
      total_rows: 1,
    },
    query: { sql: '', params: {} },
  };

  const mockDimensionResponse = {
    data: {
      current: [
        { landing_path: '/home', sessions: 165, median_duration: 384 },
        { landing_path: '/about', sessions: 268, median_duration: 358 },
      ],
      previous: [
        { landing_path: '/home', sessions: 150, median_duration: 360 },
        { landing_path: '/about', sessions: 250, median_duration: 340 },
      ],
    },
    meta: {
      metrics: ['sessions', 'median_duration'],
      dimensions: ['landing_path'],
      dateRange: { start: '2024-01-01', end: '2024-01-01' },
      compareDateRange: { start: '2023-12-31', end: '2023-12-31' },
      total_rows: 2,
    },
    query: { sql: '', params: {} },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportGeneratorService,
        {
          provide: AnalyticsService,
          useValue: {
            query: jest.fn().mockImplementation((params) => {
              // Return different responses based on whether dimensions are requested
              if (params.dimensions && params.dimensions.length > 0) {
                return Promise.resolve(mockDimensionResponse);
              }
              return Promise.resolve(mockMetricsResponse);
            }),
          },
        },
        {
          provide: WorkspacesService,
          useValue: {
            get: jest.fn().mockResolvedValue(mockWorkspace),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn().mockResolvedValue(mockUser),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:5173'),
          },
        },
      ],
    }).compile();

    service = module.get<ReportGeneratorService>(ReportGeneratorService);
    analyticsService = module.get(AnalyticsService);
    workspacesService = module.get(WorkspacesService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);
  });

  describe('generate', () => {
    it('should query analytics service with correct params', async () => {
      await service.generate(mockSubscription);

      expect(analyticsService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: 'ws-123',
          metrics: ['sessions', 'median_duration'],
        }),
      );
    });

    it('should include comparison to previous period', async () => {
      await service.generate(mockSubscription);

      expect(analyticsService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          compareDateRange: expect.any(Object),
        }),
      );
    });

    it('should query each selected dimension', async () => {
      await service.generate(mockSubscription);

      // Should have called query for metrics + once for each dimension
      expect(analyticsService.query).toHaveBeenCalledTimes(3); // 1 metrics + 2 dimensions
    });

    it('should apply stored filters', async () => {
      const subscriptionWithFilters = {
        ...mockSubscription,
        filters: JSON.stringify([
          { dimension: 'country', operator: 'equals', values: ['US'] },
        ]),
      };

      await service.generate(subscriptionWithFilters);

      expect(analyticsService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [
            { dimension: 'country', operator: 'equals', values: ['US'] },
          ],
        }),
      );
    });

    it('should format TimeScore as duration in dimension breakdowns', async () => {
      const reportData = await service.generate(mockSubscription);

      // The mock returns median_duration: 384 (seconds)
      // Should be formatted as '6m 24s'
      const landingDimension = reportData.dimensions.find(
        (d) => d.dimension === 'landing_path',
      );
      expect(landingDimension).toBeDefined();
      expect(landingDimension!.rows[0].formattedMetric).toBe('6m 24s');
      expect(landingDimension!.rows[1].formattedMetric).toBe('5m 58s');
    });

    it('should render correctly formatted HTML for dimension breakdowns', async () => {
      const reportData = await service.generate(mockSubscription);
      const html = service.renderEmail(reportData, mockSubscription);

      // TimeScore should be formatted as duration, not raw seconds
      expect(html).toContain('6m 24s');
      expect(html).toContain('5m 58s');

      // Should NOT contain raw seconds values like ">384<" or ">358<"
      expect(html).not.toContain('>384<');
      expect(html).not.toContain('>358<');
    });
  });

  describe('renderEmail', () => {
    it('should compile MJML to valid HTML', async () => {
      const reportData = await service.generate(mockSubscription);
      const html = service.renderEmail(reportData, mockSubscription);

      expect(html).toContain('<!doctype html>');
      expect(html).toContain('<html');
    });

    it('should include metrics summary', async () => {
      const reportData = await service.generate(mockSubscription);
      const html = service.renderEmail(reportData, mockSubscription);

      expect(html).toContain('Sessions');
    });

    it('should include dimension tables', async () => {
      const reportData = await service.generate(mockSubscription);
      const html = service.renderEmail(reportData, mockSubscription);

      // Should mention the dimension names
      expect(html).toContain('Landing');
    });

    it('should include unsubscribe link', async () => {
      const reportData = await service.generate(mockSubscription);
      const html = service.renderEmail(reportData, mockSubscription);

      expect(html).toContain('unsubscribe');
    });

    it('should include dashboard link', async () => {
      const reportData = await service.generate(mockSubscription);
      const html = service.renderEmail(reportData, mockSubscription);

      expect(html).toContain('View Dashboard');
    });

    it('should include Staminads logo', async () => {
      const reportData = await service.generate(mockSubscription);
      const html = service.renderEmail(reportData, mockSubscription);

      expect(html).toContain('favicon.svg');
    });

    it('should include workspace info with website', async () => {
      const reportData = await service.generate(mockSubscription);
      const html = service.renderEmail(reportData, mockSubscription);

      expect(html).toContain(reportData.workspace.name);
      expect(html).toContain('example.com'); // website without protocol
    });
  });

  describe('generateUnsubscribeToken', () => {
    it('should generate valid JWT with subscription ID', () => {
      const token = service.generateUnsubscribeToken('sub-123');

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'sub-123',
          action: 'unsubscribe',
        }),
        expect.any(Object),
      );
      expect(token).toBe('mock-jwt-token');
    });

    it('should expire in 30 days', () => {
      service.generateUnsubscribeToken('sub-123');

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          expiresIn: '30d',
        }),
      );
    });
  });

  describe('renderEmail formatting', () => {
    it('should render sessions as integers without decimals', () => {
      const reportData = {
        workspace: {
          id: 'ws-123',
          name: 'Test Workspace',
          timezone: 'UTC',
          website: 'https://example.com',
        },
        reportName: 'Daily Report',
        dateRange: { start: '2024-01-01', end: '2024-01-01' },
        dateRangeLabel: 'Jan 1, 2024 (UTC)',
        metrics: [
          {
            key: 'sessions',
            label: 'Sessions',
            current: 164.5,
            previous: 150,
            changePercent: 9.7,
            formatted: '165',
            formattedPrevious: '150',
            trend: 'up' as const,
            trendClass: 'positive',
            trendPrefix: '+',
          },
        ],
        dimensions: [
          {
            dimension: 'landing_path',
            label: 'Landing Pages',
            rows: [
              {
                value: '/iphone/',
                sessions: 165,
                sessionsEvo: 10,
                sessionsEvoClass: 'positive',
                metric: 384,
                metricEvo: 5,
                metricEvoClass: 'positive',
                formattedMetric: '6m 24s',
              },
              {
                value: '/about/',
                sessions: 268,
                sessionsEvo: -5,
                sessionsEvoClass: 'negative',
                metric: 358,
                metricEvo: null,
                metricEvoClass: 'neutral',
                formattedMetric: '5m 58s',
              },
            ],
          },
        ],
        filters: [],
        dashboardUrl: 'http://localhost:5173/workspaces/ws-123',
        unsubscribeUrl: 'http://localhost:5173/unsubscribe?token=test',
      };

      const html = service.renderEmail(reportData, mockSubscription);

      // Sessions should appear as integers (165, 268), not floats
      expect(html).toContain('>165<');
      expect(html).toContain('>268<');
      expect(html).not.toMatch(/>\d+\.\d+</); // No decimal values in cells
    });

    it('should render TimeScore as formatted duration', () => {
      const reportData = {
        workspace: {
          id: 'ws-123',
          name: 'Test Workspace',
          timezone: 'UTC',
          website: 'https://example.com',
        },
        reportName: 'Daily Report',
        dateRange: { start: '2024-01-01', end: '2024-01-01' },
        dateRangeLabel: 'Jan 1, 2024 (UTC)',
        metrics: [
          {
            key: 'median_duration',
            label: 'TimeScore',
            current: 471,
            previous: 400,
            changePercent: 17.8,
            formatted: '7m 51s',
            formattedPrevious: '6m 40s',
            trend: 'up' as const,
            trendClass: 'positive',
            trendPrefix: '+',
          },
        ],
        dimensions: [
          {
            dimension: 'landing_path',
            label: 'Landing Pages',
            rows: [
              {
                value: '/iphone-17-pro/',
                sessions: 259,
                sessionsEvo: 10,
                sessionsEvoClass: 'positive',
                metric: 471,
                metricEvo: 5,
                metricEvoClass: 'positive',
                formattedMetric: '7m 51s',
              },
              {
                value: '/iphone/',
                sessions: 165,
                sessionsEvo: -5,
                sessionsEvoClass: 'negative',
                metric: 384,
                metricEvo: null,
                metricEvoClass: 'neutral',
                formattedMetric: '6m 24s',
              },
            ],
          },
        ],
        filters: [],
        dashboardUrl: 'http://localhost:5173/workspaces/ws-123',
        unsubscribeUrl: 'http://localhost:5173/unsubscribe?token=test',
      };

      const html = service.renderEmail(reportData, mockSubscription);

      // TimeScore should be formatted as duration, not raw seconds
      expect(html).toContain('7m 51s');
      expect(html).toContain('6m 24s');
      // Should NOT contain raw seconds values in the dimension table
      expect(html).not.toContain('>471<');
      expect(html).not.toContain('>384<');
    });

    it('should render TimeScore under 60s with seconds only', () => {
      const reportData = {
        workspace: {
          id: 'ws-123',
          name: 'Test Workspace',
          timezone: 'UTC',
          website: 'https://example.com',
        },
        reportName: 'Daily Report',
        dateRange: { start: '2024-01-01', end: '2024-01-01' },
        dateRangeLabel: 'Jan 1, 2024 (UTC)',
        metrics: [],
        dimensions: [
          {
            dimension: 'landing_path',
            label: 'Landing Pages',
            rows: [
              {
                value: '/quick-page/',
                sessions: 50,
                sessionsEvo: null,
                sessionsEvoClass: 'neutral',
                metric: 45,
                metricEvo: null,
                metricEvoClass: 'neutral',
                formattedMetric: '45s',
              },
            ],
          },
        ],
        filters: [],
        dashboardUrl: 'http://localhost:5173/workspaces/ws-123',
        unsubscribeUrl: 'http://localhost:5173/unsubscribe?token=test',
      };

      const html = service.renderEmail(reportData, mockSubscription);

      expect(html).toContain('45s');
    });
  });
});
