# Kraken Tracking

A self-hosted portfolio tracker for Kraken exchange that unifies **Futures** and **Spot** market data into a single API with server-rendered HTML dashboards.

Built with TypeScript on Node.js 24 (native `.ts` execution, zero build step).

## What It Does

- Proxies authenticated Kraken Futures + Spot APIs through a single local server
- Computes **FIFO cost basis** and realized P&L for all spot trades (Koinly-compatible)
- Tracks closed **margin positions** with leverage, fees, and P&L percentages
- Aggregates **funding fees**, **rollovers**, and **cross-exchange transfers**
- Renders dark-themed HTML dashboards (positions tables + transaction card lists)
- Caches slow spot endpoints with a 5-minute TTL

## API Endpoints

### Futures

| Endpoint | Description |
|----------|-------------|
| `GET /futures/balances` | Flex + cash account balances |
| `GET /futures/positions` | Derivatives position history |
| `GET /futures/transactions` | P&L, funding fees, transfers |
| `GET /futures/positions/view` | HTML positions table |
| `GET /futures/transactions/view` | HTML transactions dashboard |

### Spot

| Endpoint | Description |
|----------|-------------|
| `GET /spots/balances` | Non-zero spot balances |
| `GET /spots/positions` | Margin position history |
| `GET /spots/transactions` | FIFO cost basis transactions |
| `GET /spots/positions/view` | HTML positions table |
| `GET /spots/transactions/view` | HTML transactions dashboard |

### System

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Server status + uptime |

Query parameters: `?since=<timestamp>` (default: 180 days) and `?count=<1-10000>` on futures endpoints.

## Tech Stack

| Concern | Choice |
|---------|--------|
| Runtime | Node.js 24 with `--experimental-strip-types` |
| Language | TypeScript (strict mode, no build step) |
| Framework | Express 4.21 |
| Logging | Pino (structured JSON in prod, pretty in dev) |
| Auth | HMAC-SHA512 (Kraken Futures + Spot protocols) |
| Caching | In-memory TTL (5min for spot data) |
| Config | dotenv |

## Project Structure

```
src/
  server.ts                  Entry point: middleware, routes, lifecycle
  auth/
    futures.ts               Kraken Futures HMAC auth client
    spot.ts                  Kraken Spot HMAC auth client + pagination
  middleware/
    auth.ts                  Bearer token guard (optional)
    logging.ts               Pino request logger
  routes/
    futures.ts               /futures/* endpoints
    spot.ts                  /spots/* endpoints + TTL cache
  types/
    common.ts                Domain types (Position, Transaction)
    kraken.ts                Raw Kraken API response shapes
  utils/
    cache.ts                 Generic TTLCache<T> class
    futures-transaction-builder.ts   P&L, funding, transfer aggregation
    spot-transaction-builder.ts      FIFO cost basis engine
    kraken-helpers.ts        Asset normalization, pair parsing
    logger.ts                Pino instance
  views/
    positions-view.ts        Table renderer (futures + spot via column config)
    transactions-view.ts     Card renderer (futures + spot via strategy pattern)
    view-utils.ts            Formatters, icons, CSS, HTML helpers
```

## Getting Started

### Prerequisites

- Node.js 24+
- Kraken API keys (Futures + Spot)

### Setup

```bash
git clone <repo-url> && cd krakfolio
npm install
```

Create a `.env` file:

```env
KRAKEN_FUTURES_PUBLIC_KEY=your_futures_public_key
KRAKEN_FUTURES_PRIVATE_KEY=your_futures_private_key
KRAKEN_SPOT_API_KEY=your_spot_api_key
KRAKEN_SPOT_API_SECRET=your_spot_api_secret

# Optional
PORT=3000
API_TOKEN=your_bearer_token
LOG_LEVEL=info
NODE_ENV=development
```

### Run

```bash
# Development (auto-reload on file changes)
npm run dev

# Production
npm start

# Type check (no emit)
npm run typecheck
```

## Architecture

```
Client Request
  |
  +-- Bearer auth middleware (optional)
  +-- Pino request logger
  |
  +-- /futures/*  -->  Futures Auth Client  -->  futures.kraken.com
  |                         |
  |                    HMAC-SHA512 signing
  |
  +-- /spots/*  -->  Spot Auth Client  -->  api.kraken.com
                         |                    (paginated, rate-limited)
                    TTL Cache (5min)
                         |
                    FIFO Cost Basis Engine
```

### Key Design Patterns

- **Factory pattern** for auth clients (`createFuturesClient`, `createSpotClient`)
- **Column-config pattern** for position tables (one generic renderer, two column definitions)
- **Strategy pattern** for transaction views (one layout, two rendering strategies)
- **Generic TTL cache** (`TTLCache<T>`) for expensive spot endpoints

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `KRAKEN_FUTURES_PUBLIC_KEY` | Yes | Futures API public key |
| `KRAKEN_FUTURES_PRIVATE_KEY` | Yes | Futures API private key |
| `KRAKEN_SPOT_API_KEY` | Yes | Spot API key |
| `KRAKEN_SPOT_API_SECRET` | Yes | Spot API secret |
| `PORT` | No | Server port (default: 3000) |
| `API_TOKEN` | No | Bearer token for auth (disabled if unset) |
| `LOG_LEVEL` | No | Pino log level (default: info) |
| `NODE_ENV` | No | `production` hides error details |

## License

Private use.
