# Kraken Exchange Tracking

A self-hosted portfolio tracker for Kraken exchange that unifies **Futures** and **Spot** market data into a single API with server-rendered HTML dashboards.

## What It Does

- Tracks  **positions** and **transactions** of futures and spot markets, including fees and P&L percentages
- Computes **FIFO cost basis** and realized P&L for all spot trades (Koinly-compatible)
- Provides **HTML dashboards** for visualizing positions and transactions with profit/loss metrics
- Exposes a **REST API** for programmatic access to all data

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
```
