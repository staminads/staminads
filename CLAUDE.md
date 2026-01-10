# Staminads

Web analytics platform for tracking TimeScore metrics.

## Project Structure

```
/api          NestJS TypeScript API
/console      React frontend (Vite + TypeScript + Ant Design)
/sdk          JavaScript/TypeScript tracking SDK
/docs         Technical documentation and specs
/releases     Release notes per version
```

## API

NestJS application with RPC-style endpoints. See `openapi.json` for full API documentation.

### Environment Variables

```
# Server
PORT=3000
JWT_EXPIRES_IN=7d
APP_URL=http://localhost:5173
CORS_ALLOWED_ORIGINS=http://localhost:5173

# Security (REQUIRED)
ENCRYPTION_KEY=<32+ chars, generate with: openssl rand -hex 32>

# ClickHouse
CLICKHOUSE_HOST=http://localhost:8123
CLICKHOUSE_SYSTEM_DATABASE=staminads_system
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=

# Demo (optional)
DEMO_SECRET=<for demo.generate/demo.delete endpoints>
IS_DEMO=false

# Geo Location (optional)
GEOIP_DB_PATH=./data/GeoLite2-City.mmdb

# Custom Dimensions Cache (optional)
CUSTOM_DIMENSIONS_CACHE_TTL_MS=15000

# Global SMTP (optional, or configure per-workspace)
SMTP_HOST=
SMTP_PORT=587
SMTP_TLS=true
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_NAME=Staminads
SMTP_FROM_EMAIL=noreply@example.com
```

### Database

ClickHouse is used for all data storage:
- Workspaces, users, sessions, memberships
- Invitations, password reset tokens
- Audit logs, API keys
- Analytics data

Schemas in `api/src/database/schemas/`.

### OpenAPI Spec

The API uses `@nestjs/swagger` with CLI plugin for automatic OpenAPI generation. Run `npm run openapi:generate` to generate `openapi.json` and `openapi.yaml`.

**Controller requirements:**
- Add `@ApiTags('tag-name')` at controller level for grouping
- Add `@ApiOperation({ summary: '...' })` on each endpoint
- For authenticated routes: add `@ApiSecurity('jwt-auth')` at controller level
- Use `@Public()` decorator for public endpoints (auto-documents as no auth required)
- Use `@DemoProtected()` for demo endpoints (auto-documents secret query param)

**What's auto-documented (via CLI plugin):**
- `@Body() dto: SomeClass` - Full request schema from DTO class
- Field constraints from class-validator decorators (`@IsString()`, `@IsUrl()`, `@IsOptional()`, etc.)

**Manual annotations needed:**
- `@Query('name')` params: add `@ApiQuery({ name: 'name', type: String, required: true })`
- `@Body('field')` partial extraction: add `@ApiBody({ schema: { ... } })`
- Response types: add `@ApiResponse({ status: 200, type: SomeClass })` or use schema

**Example controller:**
```typescript
@ApiTags('workspaces')
@ApiSecurity('jwt-auth')
@Controller('api')
export class WorkspacesController {
  @Get('workspaces.get')
  @ApiOperation({ summary: 'Get workspace by ID' })
  @ApiQuery({ name: 'id', type: String, required: true })
  get(@Query('id') id: string) {
    return this.service.get(id);
  }
}
```

### Running

```bash
# Start ClickHouse
docker compose up -d

# Run API
cd api
cp .env.example .env  # then edit with your values
npm run start:dev
```

## Console (Frontend)

React application with Vite, TypeScript, TanStack Router/Query, and Ant Design.

### Scripts

```bash
cd console
npm run dev          # Start dev server
npm run build        # Build for production
npm run lint         # Run ESLint + TypeScript type checking
npm run type-check   # TypeScript type checking only
npm run copy-sdk     # Copy SDK from /sdk/dist to public/
npm run preview      # Preview production build
```

### Linting

The `npm run lint` command runs both ESLint and TypeScript compiler:
- **ESLint**: Checks code style, React hooks rules, and React Refresh compatibility
- **TypeScript** (`tsc --noEmit`): Checks all type errors (same errors shown in VSCode)

This ensures CLI linting catches the same errors as your IDE.

## SDK

JavaScript/TypeScript SDK for tracking TimeScore metrics.

### Scripts

```bash
cd sdk
npm run build         # Build UMD/ESM/CJS bundles
npm run dev           # Watch mode
npm run test          # Run unit tests
npm run test:watch    # Watch mode
npm run test:e2e      # Run Playwright E2E tests
npm run type-check    # TypeScript check
npm run lint          # ESLint
```

### Output

Built to `dist/`:
- `staminads.min.js` - UMD bundle for script tags
- `staminads.esm.js` - ESM for modern bundlers
- `staminads.cjs.js` - CommonJS for Node.js
- `staminads.d.ts` - TypeScript declarations

## Versioning

Version is defined in `api/src/version.ts` and used by API, console, and SDK.

- **Major (X.0.0)**: Database schema changes (requires migration)
- **Minor (0.X.0)**: Features and fixes without schema changes

### Version Synchronization

All components share the same version from `api/src/version.ts`:
- **API**: Imports directly
- **Console**: Injected via Vite (`__APP_VERSION__`)
- **SDK**: Injected via Rollup (`__SDK_VERSION__`)
- **SDK package.json**: Synced by `npm run sync-version` (runs on prebuild)

When updating the version:
1. Edit `api/src/version.ts`
2. Rebuild SDK: `cd sdk && npm run build`
3. Copy SDK: `cd console && npm run copy-sdk`

## Release Process

When releasing a new version:

1. Run linters and build to verify no errors:
   - `cd console && npm run lint && npm run build`
   - `cd api && npm run lint && npm run build`
2. Update version in `api/src/version.ts`
3. Update `CHANGELOG.md`
4. Create release notes file in `releases/`

### Minor Version Release

- **CHANGELOG.md**: Add short entry (1-2 lines per change)
- **Release notes**: Create `releases/v{X.Y.0}.md` with concise bullet points

Example CHANGELOG entry:
```
## 2.1.0
- Add dashboard mobile layout
- Fix SDK snippet configuration
```

Example release notes (`releases/v2.1.0.md`):
```markdown
# v2.1.0

- Mobile-responsive dashboard layout
- Updated SDK integration snippet
```

### Major Version Release

- **CHANGELOG.md**: Add detailed entry describing breaking changes and migration steps
- **Release notes**: Create `releases/v{X.0.0}.md` with full feature descriptions

Example CHANGELOG entry:
```
## 3.0.0
### Breaking Changes
- New session schema with additional metrics columns
- Requires database migration (see releases/v3.0.0.md)

### New Features
- Real-time analytics dashboard
- Custom event tracking
```

Example release notes (`releases/v3.0.0.md`):
```markdown
# v3.0.0

## Breaking Changes
Database schema updated. Run migration before upgrading.

## New Features
### Real-time Analytics
Description of the feature and how to use it.

### Custom Event Tracking
Description of the feature and configuration options.

## Migration Guide
Step-by-step migration instructions.
```

## Development Guidelines

### Git Commits

Do NOT include "Generated with Claude Code" or "Co-Authored-By" footers in commit messages. Use simple, clean commit messages.

### Running the API Server

**Do not start the API server unless explicitly required.** For most tasks (code changes, builds, unit tests), starting the server is unnecessary.

When the server is needed:
- Run in **foreground** (no `&`), so it can be stopped with Ctrl+C
- Use a **custom port** (e.g., 4000) to avoid conflicts: `PORT=4000 npm run start:dev`
- Kill it after use

### Web Server Ports

Port 3000 is reserved for the main API. When starting any temporary web server (e.g., for testing, previewing, or debugging), use a different port (e.g., 4000, 5000, 8080) and kill it after use.
