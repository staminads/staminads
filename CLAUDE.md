# Staminads

Web analytics platform for tracking TimeScore metrics.

## Project Structure

```
/api          NestJS TypeScript API
/console      React frontend (Vite + TypeScript + Ant Design)
```

## API

NestJS application with RPC-style endpoints.

### Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth.login` | POST | No | Login with admin credentials |
| `/api/workspaces.list` | GET | Yes | List all workspaces |
| `/api/workspaces.get` | GET | Yes | Get workspace by id |
| `/api/workspaces.create` | POST | Yes | Create workspace |
| `/api/workspaces.update` | POST | Yes | Update workspace |
| `/api/workspaces.delete` | POST | Yes | Delete workspace |
| `/api/tools.websiteMeta` | POST | No | Fetch website title and logo |
| `/api/demo.generate?secret=<DEMO_SECRET>` | POST | Secret | Generate demo fixtures (10k sessions) |
| `/api/demo.delete?secret=<DEMO_SECRET>` | POST | Secret | Delete demo workspace and sessions |

### Environment Variables

```
JWT_SECRET=<required>
JWT_EXPIRES_IN=7d
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<required>
PORT=3000

# Demo fixtures (optional)
DEMO_SECRET=<optional, required for demo endpoints>

# ClickHouse
CLICKHOUSE_HOST=http://localhost:8123
CLICKHOUSE_DATABASE=staminads
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
```

### Database

ClickHouse is used for storing workspaces and web sessions. Schemas in `api/src/database/schemas/`.

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
```

### Linting

The `npm run lint` command runs both ESLint and TypeScript compiler:
- **ESLint**: Checks code style, React hooks rules, and React Refresh compatibility
- **TypeScript** (`tsc --noEmit`): Checks all type errors (same errors shown in VSCode)

This ensures CLI linting catches the same errors as your IDE.

## Development Guidelines

### Running the API Server

**Do not start the API server unless explicitly required.** For most tasks (code changes, builds, unit tests), starting the server is unnecessary.

When the server is needed:
- Run in **foreground** (no `&`), so it can be stopped with Ctrl+C
- Use a **custom port** (e.g., 4000) to avoid conflicts: `PORT=4000 npm run start:dev`
- Kill it after use

### Web Server Ports

Port 3000 is reserved for the main API. When starting any temporary web server (e.g., for testing, previewing, or debugging), use a different port (e.g., 4000, 5000, 8080) and kill it after use.
