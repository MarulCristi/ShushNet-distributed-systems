# ShushNet - Distributed Complaint Escalation System
 
## Architecture Overview
 
ShushNet uses a three-service architecture:
 
**Broker** (Port 3000) - Central complaint router, strike tracker, Socket.IO real-time alert hub, and escalation trigger at 3 strikes.
 
**Building Manager** (Port 3001) - Manager CLI for tenant registration, escalation webhook receiver, and escalation log writer.
 
**Apartment Client** (Multiple instances) - Tenant CLI for login and complaint filing, Socket.IO real-time alert receiver, and strike view command.
 
---
 
## Completed Features
 
### ✅ Step 1 - Core Infrastructure
- Express.js 4 REST API
- Socket.IO 4 real-time messaging
- MongoDB 7 with Mongoose 8
- TypeScript 5 with strict mode
### ✅ Step 2 - REST Endpoints & Models
- `POST /manager/register-tenant`
- `POST /tenant/login`
- `POST /complaint`
- `GET /strikes/:tenantId`
- `DELETE /manager/tenant/:tenantId`
### ✅ Step 3 - Real-Time Alerts & Role Separation
- Managers register tenants via the building-manager CLI
- Tenants log in via the apartment-client CLI
- Socket.IO rooms scoped by `tenantId`
- 6-flash red alert display (1.8 seconds)
- Separate CLI interfaces per role
### ✅ Step 4 - Strike Escalation Webhook
- Broker detects the 3-strike threshold
- `POST` escalation to building-manager `/escalate` endpoint
- Escalation logged to `building-manager/logs/escalation.log`
- Log format: `[ISO_TIMESTAMP] Escalation - Apartment: {apt}, Strikes: 3`
---
 
## Tested Workflows
 
### Manager Registration
1. Alice enters: `apt-001`
2. Alice enters: `Alice`
3. Alice commands: `r Jane Smith` → `tenant-6603366a` created
4. Alice commands: `r John Doe` → `tenant-f534d29c` created
### Tenant Login
1. John starts `apartment-client`
2. John enters: `John Doe`
3. John logs in successfully with `tenantId` + `apartmentId`
### Complaint Filing & Escalation
1. John: `c tenant-6603366a Loud music` → Strike 1 for Jane
2. John: `c tenant-6603366a Banging on walls` → Strike 2 for Jane
3. John: `c tenant-6603366a Stomping on floors` → Strike 3 for Jane → 🚨 escalation webhook triggered
**Escalation verified:**
- Broker log: `🚨 ESCALATION: 3 strikes reached! Webhook sent to Building Manager`
- Manager log: `⚠️ ESCALATION: Apartment apt-001 reached 3 strikes`
- Log file: `[2026-04-24T17:02:50.330Z] Escalation - Apartment: apt-001, Strikes: 3`
---
 
## Database Schema
 
**Apartments**
- `apartmentId` - string (not unique; allows multiple tenants per apartment)
- `managerName` - string
- `tenantName` - string (lowercase, trimmed, unique)
- `tenantId` - string (unique)
- `createdAt` - Date
**Complaints**
- `tenantId` - target tenant
- `apartmentId` - string
- `content` - string
- `timestamp` - Date
**Strikes**
- `tenantId` - unique
- `apartmentId` - string
- `count` - incremented with each complaint
- `lastStrikeTime` - Date
- `expiresAt` - TTL index for nightly reset at midnight
---
 
## Quick Start
 
### Prerequisites
- Node.js 20 LTS
- MongoDB 7 running on `localhost:27017`
### Install Dependencies
```bash
npm install
cd shushnet && npm install
npm run install-all
```
 
### Run All Services
```bash
# Terminal 1
cd shushnet/broker && npm run dev        # Port 3000
 
# Terminal 2
cd shushnet/building-manager && npm run dev  # Port 3001
 
# Terminal 3
cd shushnet/apartment-client && npm run dev  # Tenant #1
 
# Terminal 4
cd shushnet/apartment-client && npm run dev  # Tenant #2
```
 
### Test Scenario
1. Manager: Apartment = `apt-001`, Name = `Alice`
2. Manager: `r Jane Smith` → note tenant ID
3. Manager: `r John Doe` → note tenant ID
4. Tenant 1: Login as `Jane Smith`
5. Tenant 2: Login as `John Doe`
6. Tenant 2: `c <jane_id> Complaint 1` → Jane sees alert (Strike: 1)
7. Tenant 2: `c <jane_id> Complaint 2` → Jane sees alert (Strike: 2)
8. Tenant 2: `c <jane_id> Complaint 3` → Jane sees alert + escalation sent (Strike: 3)
9. Check building-manager terminal: escalation message logged
10. Check `logs/escalation.log`: timestamp entry recorded
### Reset Database
```bash
cd shushnet && node cleanup.js
```
 
---
 
## Commands Reference
 
### Manager CLI (`building-manager`)
 
| Command | Description |
|---|---|
| `r <full-name>` | Register a tenant (e.g. `r Jane Smith`) |
| `d <tenant-id>` | Delete a tenant (e.g. `d tenant-abc123`) |
| `q` | Quit |
 
### Tenant CLI (`apartment-client`)
 
| Command | Description |
|---|---|
| `c <tenant-id> <message>` | File a complaint (e.g. `c tenant-xyz Loud music`) |
| `s <tenant-id>` | View strikes (e.g. `s tenant-xyz`) |
| `q` | Quit |
 
### Error Messages
 
| Message | Cause |
|---|---|
| `Tenant already registered` | Name is already taken in this apartment |
| `Tenant not registered` | Login attempted with an unregistered name |
| `No clients listening` | Recipient is not logged in; alert queued for next login |
 
---
 
## Key Files
 
| File | Purpose |
|---|---|
| `broker/src/index.ts` | Central complaint routing logic |
| `broker/src/models/Apartment.ts` | Tenant registration schema |
| `broker/src/models/Strike.ts` | Strike tracking with TTL |
| `building-manager/src/index.ts` | Manager CLI + escalation endpoint |
| `apartment-client/src/index.ts` | Tenant CLI + alert display |
| `cleanup.js` | Database reset script |
 
---
 
## Roadmap
 
### Step 5 - Enhanced UI & Formatting
- Color-coded message types
- Complaint history in tenant view
- Improved multi-apartment display formatting
- Escalation alert in building-manager console
### Step 6 - Report Generation
- Daily summary reports
- Exportable escalation history
- Per-apartment complaint statistics
- Recurring offender tracking
---
 
## Troubleshooting
 
**Port already in use (Windows)**
```powershell
$process = Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -First 1
Stop-Process -Id $process.OwningProcess
```
 
**MongoDB connection failed** - Verify MongoDB is running (`mongosh`), the `shush-net` database exists, and the connection string in `.env` files is correct.
 
**Socket.IO not connecting** - Restart the broker service and verify ports 3000 and 3001 are accessible.
 
**Tenants not receiving alerts** - The tenant must be logged in and Socket.IO connected. Check broker logs for `No clients listening`. Alerts are delivered on next login if the tenant is offline.
 
---
 
## Notes
 
- Managers register tenants through the **building-manager CLI**, not the apartment-client CLI. This separation enforces proper role-based access.
- The escalation webhook fires automatically when any tenant reaches **3 strikes within the same day**. Strikes reset nightly at midnight UTC via a TTL index.
