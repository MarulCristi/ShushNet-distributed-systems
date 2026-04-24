import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { connectDB } from './db';
import fs from 'fs';
import path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3000';

const api = axios.create({ baseURL: BROKER_URL });

// Middleware
app.use(express.json());

// Create escalation log directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ============ REST ENDPOINTS ============

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Building Manager is running ✓' });
});

// Escalation webhook endpoint (from broker)
app.post('/escalate', (req, res) => {
  const { apartmentId, strikeCount } = req.body;

  if (!apartmentId || !strikeCount) {
    return res.status(400).json({ error: 'Missing apartmentId or strikeCount' });
  }

  console.log(`\n⚠️  ESCALATION: Apartment ${apartmentId} reached ${strikeCount} strikes`);

  // Log to file
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] Escalation - Apartment: ${apartmentId}, Strikes: ${strikeCount}\n`;
  
  fs.appendFileSync(
    path.join(logsDir, 'escalation.log'),
    logEntry
  );

  res.json({
    success: true,
    message: `Escalation logged for ${apartmentId}`,
    timestamp,
  });
});

// Get escalation history
app.get('/escalations', (req, res) => {
  try {
    const logPath = path.join(logsDir, 'escalation.log');
    if (!fs.existsSync(logPath)) {
      return res.json({ escalations: [] });
    }

    const logs = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(l => l);
    res.json({ escalations: logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read escalations' });
  }
});

// ============ MANAGER CLI ============

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

let apartmentId: string = '';
let managerName: string = '';

const managerSetup = async () => {
  const aptId = await question('Enter apartment ID (e.g., apt-001): ');
  const mgr = await question('Enter your name: ');

  apartmentId = aptId;
  managerName = mgr;

  console.log(`\n✓ Manager setup complete`);
  console.log(`  Apartment: ${apartmentId}`);
  console.log(`  Manager: ${managerName}\n`);

  showMenu();
  managerPrompt();
};

const showMenu = () => {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Manager: ${managerName} (${apartmentId})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  r <full-name>   - Register tenant`);
  console.log(`  d <tenant-id>   - Delete tenant`);
  console.log(`  q               - Quit`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
};

const managerPrompt = async () => {
  const input = await question('> ');
  const parts = input.trim().split(' ');
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case 'r':
      if (parts.length < 2) {
        console.log('Usage: r <full-name>\n');
      } else {
        const tenantNameToRegister = parts.slice(1).join(' ');
        await registerTenant(tenantNameToRegister);
      }
      break;
    case 'd':
      if (parts.length < 2) {
        console.log('Usage: d <tenant-id>\n');
      } else {
        await deleteTenant(parts[1]);
      }
      break;
    case 'q':
      console.log('\nShutting down...');
      rl.close();
      process.exit(0);
    default:
      console.log('Unknown command\n');
  }

  managerPrompt();
};

const registerTenant = async (tenantNameToReg: string) => {
  try {
    const response = await api.post('/manager/register-tenant', {
      apartmentId,
      managerName,
      tenantName: tenantNameToReg,
    });
    console.log(`✓ Tenant registered!`);
    console.log(`  Name: ${tenantNameToReg}`);
    console.log(`  ID: ${response.data.tenantId}\n`);
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 
                     error.response?.data?.message ||
                     error.response?.statusText ||
                     error.message ||
                     'Unknown error';
    console.error(`✗ Failed: ${errorMsg}\n`);
  }
};

const deleteTenant = async (delTenantId: string) => {
  try {
    const response = await api.delete(`/manager/tenant/${delTenantId}`);
    console.log(`✓ Tenant deleted\n`);
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 
                     error.response?.data?.message ||
                     error.response?.statusText ||
                     error.message ||
                     'Unknown error';
    console.error(`✗ Failed: ${errorMsg}\n`);
  }
};

// ============ START SERVER ============
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start HTTP server
    app.listen(PORT, () => {
      console.log(chalk.cyan(`\n╔════════════════════════════════════╗`));
      console.log(chalk.cyan(`║  🏢 ShushNet Manager CLI 🏢       ║`));
      console.log(chalk.cyan(`╚════════════════════════════════════╝\n`));
      console.log(`✓ Building Manager running on http://localhost:${PORT}`);
      console.log(`📝 Ready to receive escalations`);
      console.log(`📊 Escalation logs: ${logsDir}\n`);
    });

    // Start manager CLI after server starts
    setTimeout(() => {
      managerSetup();
    }, 500);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  rl.close();
  process.exit(0);
});
