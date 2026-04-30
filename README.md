# ShushNet

Distributed apartment complaints system with:
- a central **Broker API** (`shushnet/broker`)
- a modern **Vite + React web app** (`shushnet/web-app`) for both manager and tenant flows
- optional legacy CLIs (`shushnet/building-manager`, `shushnet/apartment-client`)

## Current Architecture

### 1. Broker API (Port `3000`)
- Express + Socket.IO + MongoDB (Mongoose)
- Single source of truth: **complaints**
- Key endpoints:
  - `POST /manager/register-apartment`
  - `DELETE /manager/apartment/:apartmentId`
  - `POST /tenant/login`
  - `POST /complaint`
  - `GET /complaints`
  - `GET /complaints/summary` (per-apartment aggregates for graph/strike views)
- Real-time complaint alerts via Socket.IO room per tenant account.

### 2. Web App (Vite + React)
- 3-view flow:
  - View 1: choose role
  - View 2: sign in (manager name or tenant apartment number + optional name)
  - View 3: graph + complaint list + complaint form
- Manager can register/evict apartments.
- Tenants can file complaints (not against themselves), view complaints against them, and receive persistent complaint alerts.

### 3. Optional Legacy CLIs
- `building-manager` (Port `3001`): escalation webhook receiver + CLI management
- `apartment-client`: tenant CLI

## One-Command Install

From repo root:

```bash
npm install
```

This repository uses npm workspaces, so one install command resolves dependencies for all packages.

## Prerequisites

- Node.js 20+
- MongoDB running (default URI: `mongodb://localhost:27017/shush-net`)

## Run Instructions

### Web-first (recommended)

From repo root:

```bash
npm run dev
```

Starts:
- Broker API on `http://localhost:3000`
- Web app on Vite dev server (usually `http://localhost:5173`)

### Legacy CLI mode

From repo root:

```bash
npm run dev:legacy
```

Starts:
- Broker
- Apartment CLI
- Building Manager CLI

### Run individual services

```bash
npm run dev:broker
npm run dev:web
```

Or directly per workspace:

```bash
npm run dev --workspace=shushnet/building-manager
npm run dev --workspace=shushnet/apartment-client
```

## Build

From repo root:

```bash
npm run build
```

## Environment Variables

### Broker (`shushnet/broker`)
- `PORT` (default `3000`)
- `MONGODB_URI` (default `mongodb://localhost:27017/shush-net`)

### Web App (`shushnet/web-app`)
- `VITE_BROKER_URL` (default `http://localhost:3000`)

### Building Manager (`shushnet/building-manager`)
- `PORT` (default `3001`)
- `BROKER_URL` (default `http://localhost:3000`)
- `MONGODB_URI` (default `mongodb://localhost:27017/shush-net`)

## Notes

- Complaint summaries are complaint-derived (`/complaints/summary`), so graph/list/strike counts come from a unified complaints data model.
- `/strikes` routes are still available for compatibility, but the current architecture is complaints-centric.
