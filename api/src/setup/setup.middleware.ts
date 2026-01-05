import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SetupService } from './setup.service';

@Injectable()
export class SetupMiddleware implements NestMiddleware {
  constructor(private readonly setupService: SetupService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl || req.url || req.path;

    // Always allow setup routes
    if (path.startsWith('/api/setup')) {
      return next();
    }

    // Allow health check endpoint if it exists
    if (req.path === '/health' || req.path === '/api/health') {
      return next();
    }

    // Check if setup is complete
    const isComplete = await this.setupService.isSetupComplete();
    if (!isComplete) {
      return res.status(503).json({
        error: 'setup_required',
        message: 'Initial setup has not been completed',
      });
    }

    next();
  }
}
