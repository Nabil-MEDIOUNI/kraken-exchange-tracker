# Kraken Portfolio MCP

Kraken Portfolio tracker with REST API, HTML dashboards, and MCP server. Tracks spot/margin/futures positions, computes FIFO cost basis, and generates German crypto tax reports.

## What It Does

- Tracks **positions** and **transactions** of futures and spot markets, including fees and P&L percentages
- Computes **FIFO cost basis** and realized P&L for all spot trades (Koinly-compatible)
- Generates **German crypto tax reports** with a single MCP tool call classifies per § 23, § 22, § 20 EStG with Freigrenze, holding period checks, and CSV export
- Provides **tax-ready transaction data**, all trades include FIFO cost basis with acquisition dates, realized gains/losses, and fees in EUR
- Provides **HTML dashboards** for visualizing positions and transactions with profit/loss metrics
- Exposes a **REST API** for programmatic access to all data
- Includes an **MCP server** (Model Context Protocol) so LLMs can query your portfolio directly

## Positions Tracking
![alt text](./public/assets/positions.png)

## Transactions Tracking
![alt text](./public/assets/transactions.png)

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

## MCP Server

The project includes an MCP server that exposes your Kraken portfolio data as tools for any MCP-compatible client (Claude Code, Codex, etc.).

### Connecting to an MCP Client

Add the MCP server to your client's settings (Claude Code, Cursor, Codex, etc.):

```json
{
  "mcpServers": {
    "kraken-portfolio": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/kraken-portfolio-mcp/src/mcp-server.ts"],
      "env": {
        "KRAKEN_FUTURES_PUBLIC_KEY": "your_futures_public_key",
        "KRAKEN_FUTURES_PRIVATE_KEY": "your_futures_private_key",
        "KRAKEN_SPOT_API_KEY": "your_spot_api_key",
        "KRAKEN_SPOT_API_SECRET": "your_spot_api_secret"
      }
    }
  }
}
```

### German Tax Report

The `kraken_tracker_german_tax_report` tool generates a complete Steuerbericht in one call. Just prompt your MCP-compatible AI assistant:

> Generate my German crypto tax report for 2025

The tool fetches all data internally (spot transactions, margin positions, futures P&L), then classifies everything under German tax law:

- **§ 23 EStG** — Spot sells and crypto-to-crypto swaps with FIFO cost basis, 1-year holding period check (Spekulationsfrist), margin positions, deductible loan fees
- **§ 22 Nr. 3 EStG** — Staking rewards at EUR fair market value on receipt date
- **§ 20 EStG** — Futures realized P&L and funding fees (USD to EUR converted), with €20,000 loss offset cap

Applies Freigrenze rules (€1,000 for private sales, €256 for staking) with year-dependent thresholds (€600 for years before 2024). Returns Elster line references and a CSV compatible with WISO Steuer and Taxfix.

## Getting Started

### Prerequisites

- Node.js 18+
- Kraken API keys (Futures + Spot)

### Setup

```bash
git clone <repo-url> && cd kraken-portfolio-mcp
npm install
```

Create a `.env` file:

```env
KRAKEN_FUTURES_PUBLIC_KEY=your_futures_public_key
KRAKEN_FUTURES_PRIVATE_KEY=your_futures_private_key
KRAKEN_SPOT_API_KEY=your_spot_api_key
KRAKEN_SPOT_API_SECRET=your_spot_api_secret
```

### Run

```bash
# Development (auto-reload on file changes)
npm run dev

# Production
npm start

# MCP Server (stdio transport for LLM clients)
npm run mcp
```
