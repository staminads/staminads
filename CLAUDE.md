# Staminads

Web analytics platform for tracking TimeScore metrics.

## Project Structure

```
/api          NestJS TypeScript API
/console      Frontend (planned)
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

### Running

```bash
# Start ClickHouse
docker compose up -d

# Run API
cd api
cp .env.example .env  # then edit with your values
npm run start:dev
```
