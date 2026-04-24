================================================================================
  SHUSHNET - DISTRIBUTED COMPLAINT ESCALATION SYSTEM
================================================================================

PROJECT STATUS: STEP 4 COMPLETE - STRIKE ESCALATION WEBHOOK

================================================================================
ARCHITECTURE OVERVIEW
================================================================================

Three-Service Architecture:

1. BROKER (Port 3000)
   - Central complaint router
   - Strike tracker
   - Socket.IO real-time alert hub
   - Escalation trigger at 3 strikes

2. BUILDING-MANAGER (Port 3001)
   - Manager CLI for tenant registration
   - Escalation webhook receiver
   - Logs escalations with timestamps

3. APARTMENT-CLIENT (Multiple instances)
   - Tenant CLI for login and complaint filing
   - Socket.IO real-time alert receiver
   - Strike view command

================================================================================
COMPLETED FEATURES (STEPS 1-4)
================================================================================

✅ STEP 1: Core Infrastructure
   - Express.js 4 REST API
   - Socket.IO 4 real-time messaging
   - MongoDB 7 with Mongoose 8
   - TypeScript 5 with strict mode

✅ STEP 2: REST Endpoints & Models
   - POST /manager/register-tenant
   - POST /tenant/login
   - POST /complaint
   - GET /strikes/:tenantId
   - DELETE /manager/tenant/:tenantId

✅ STEP 3: Real-Time Alerts & Manager/Tenant Separation
   - Managers register tenants via building-manager CLI
   - Tenants login via apartment-client CLI
   - Socket.IO rooms by tenantId
   - 6-flash red alert display (1.8 seconds)
   - Separate CLI interfaces

✅ STEP 4: Strike Escalation Webhook
   - Broker detects 3-strike threshold
   - POST escalation to building-manager /escalate endpoint
   - Escalation logged to building-manager/logs/escalation.log
   - Log format: [ISO_TIMESTAMP] Escalation - Apartment: {apt}, Strikes: 3

================================================================================
TESTED WORKFLOWS
================================================================================

Manager Registration Flow:
  1. Alice enters: apt-001
  2. Alice enters: Alice
  3. Alice commands: r Jane Smith → tenant-6603366a created
  4. Alice commands: r John Doe → tenant-f534d29c created

Tenant Login Flow:
  1. John starts apartment-client
  2. John enters: John Doe
  3. John logs in successfully with tenantId + apartmentId

Complaint Filing Flow:
  1. John commands: c tenant-6603366a Loud music
     → Strike: 1 for Jane
  2. John commands: c tenant-6603366a Banging on walls
     → Strike: 2 for Jane
  3. John commands: c tenant-6603366a Stomping on floors
     → Strike: 3 for Jane
     → 🚨 ESCALATION WEBHOOK TRIGGERED
     → building-manager receives and logs

Escalation Webhook Verified:
  Broker Log: "🚨 ESCALATION: 3 strikes reached! Webhook sent to Building Manager"
  Manager Log: "⚠️  ESCALATION: Apartment apt-001 reached 3 strikes"
  Log File: "[2026-04-24T17:02:50.330Z] Escalation - Apartment: apt-001, Strikes: 3"

================================================================================
DATABASE SCHEMA
================================================================================

Apartments Collection:
  - apartmentId (string, not unique - allows multiple tenants per apt)
  - managerName (string)
  - tenantName (string, lowercase, trimmed, unique)
  - tenantId (string, unique)
  - createdAt (Date)

Complaints Collection:
  - tenantId (target tenant)
  - apartmentId
  - content (string)
  - timestamp (Date)

Strikes Collection:
  - tenantId (unique)
  - apartmentId
  - count (incremented with each complaint)
  - lastStrikeTime (Date)
  - expiresAt (TTL index for nightly reset at midnight)

================================================================================
QUICK START GUIDE
================================================================================

Prerequisites:
  - Node.js 20 LTS
  - MongoDB 7 running on localhost:27017
  - Create database: use shush-net

Install Dependencies:
  npm install
  cd shushnet && npm install
  npm run install-all

Run All Services:
  Terminal 1: cd shushnet/broker && npm run dev       [Port 3000]
  Terminal 2: cd shushnet/building-manager && npm run dev [Port 3001]
  Terminal 3: cd shushnet/apartment-client && npm run dev [Tenant #1]
  Terminal 4: cd shushnet/apartment-client && npm run dev [Tenant #2]

Test Scenario:
  1. Manager: Apartment = apt-001, Name = Alice
  2. Manager: r Jane Smith → note tenant ID
  3. Manager: r John Doe → note tenant ID
  4. Tenant 1: Login as Jane Smith
  5. Tenant 2: Login as John Doe
  6. Tenant 2: c <jane_id> Complaint 1 → Jane sees alert (Strike: 1)
  7. Tenant 2: c <jane_id> Complaint 2 → Jane sees alert (Strike: 2)
  8. Tenant 2: c <jane_id> Complaint 3 → Jane sees alert + escalation sent (Strike: 3)
  9. Check building-manager terminal: escalation message logged
  10. Check logs/escalation.log: timestamp entry recorded

Clean Database Between Tests:
  cd shushnet && node cleanup.js

================================================================================
COMMANDS REFERENCE
================================================================================

MANAGER CLI (building-manager):
  r <full-name>    - Register tenant (e.g., r Jane Smith)
  d <tenant-id>    - Delete tenant (e.g., d tenant-abc123)
  q                - Quit

TENANT CLI (apartment-client):
  c <tenant-id> <message>  - File complaint (e.g., c tenant-xyz Loud music)
  s <tenant-id>            - View strikes (e.g., s tenant-xyz)
  q                        - Quit

ERROR MESSAGES:
  "Tenant already registered" - Name taken in this apartment
  "Tenant not registered" - Login with unregistered name
  "No clients listening" - Recipient not logged in (alert queued for next login)

================================================================================
NEXT STEPS (STEP 5-6)
================================================================================

STEP 5: Enhanced UI/Formatting
  - Color-code different message types
  - Show complaint history in tenant view
  - Improved formatting for multi-apartment displays
  - Escalation alert in building-manager console

STEP 6: Report Generation
  - Generate daily summary reports
  - Export escalation history
  - Per-apartment complaint statistics
  - Recurring offender tracking

================================================================================
TROUBLESHOOTING
================================================================================

Port Already in Use:
  Windows: $process = Get-NetTCPConnection -LocalPort 3000 -State Listen | 
           Select-Object -First 1; Stop-Process -Id $process.OwningProcess

MongoDB Connection Failed:
  - Verify MongoDB is running: mongosh
  - Verify database exists: use shush-net
  - Check connection string in .env files

Socket.IO Not Connecting:
  - Restart broker service
  - Check browser console (if using web client)
  - Verify ports 3000, 3001 are accessible

Tenants Not Receiving Alerts:
  - Tenant must be logged in and Socket.IO connected
  - Check broker logs for "No clients listening"
  - Alerts are delivered on next login if tenant offline

================================================================================
KEY FILES
================================================================================

broker/src/index.ts              - Central complaint routing logic
broker/src/models/Apartment.ts   - Tenant registration schema
broker/src/models/Strike.ts      - Strike tracking with TTL
building-manager/src/index.ts    - Manager CLI + escalation endpoint
apartment-client/src/index.ts    - Tenant CLI + alert display
cleanup.js                       - Database reset script

================================================================================
CONTACT / NOTES
================================================================================

Manager is supposed to register managers through the building-manager CLI,
not the apartment-client CLI. Tenants login and file complaints via
apartment-client CLI. This separation ensures proper role-based access.

Escalation webhook is triggered automatically when any tenant reaches
3 strikes within the same day (TTL reset at midnight UTC).

For detailed technical documentation, see README.md

================================================================================
Last Updated: 2026-04-24
Status: Production Ready (Steps 1-4)
================================================================================
