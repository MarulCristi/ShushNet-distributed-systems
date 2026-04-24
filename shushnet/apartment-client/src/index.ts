import { io } from 'socket.io-client';
import axios from 'axios';
import * as readline from 'readline';
import chalk from 'chalk';

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3000';
const api = axios.create({ baseURL: BROKER_URL });

let socket: ReturnType<typeof io>;
let tenantId: string = '';
let tenantName: string = '';
let apartmentId: string = '';
let alertTimeout: NodeJS.Timeout | null = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

// ============ ALERT DISPLAY ============
const displayFlashingAlert = (strikeCount: number) => {
  if (alertTimeout) clearTimeout(alertTimeout);

  let flashCount = 0;
  const maxFlashes = 6;

  const showAlert = () => {
    if (flashCount % 2 === 0) {
      console.clear();
      console.log(
        chalk.bgRed.black.bold(`
╔═══════════════════════════════════════╗
║                                       ║
║           🚨  ALERT  🚨               ║
║                                       ║
║      Complaint Filed Against You!     ║
║                                       ║
║      Total Strikes: ${strikeCount.toString().padEnd(17)}  ║
║                                       ║
║      Timestamp: ${new Date().toLocaleTimeString().padEnd(16)}║
║                                       ║
╚═══════════════════════════════════════╝
`)
      );
    } else {
      console.clear();
      console.log(chalk.black(`
╔═══════════════════════════════════════╗
║                                       ║
║                                       ║
║                                       ║
║                                       ║
║                                       ║
║                                       ║
║                                       ║
║                                       ║
║                                       ║
╚═══════════════════════════════════════╝
`));
    }

    flashCount++;
    if (flashCount < maxFlashes) {
      alertTimeout = setTimeout(showAlert, 300);
    } else {
      console.clear();
      showMenu();
    }
  };

  showAlert();
};

// ============ TENANT LOGIN ============
const tenantLogin = async () => {
  const name = await question('Enter your full name: ');

  try {
    const response = await api.post('/tenant/login', { tenantName: name });
    tenantName = name;
    tenantId = response.data.tenantId;
    apartmentId = response.data.apartmentId;

    console.log(`\n✓ ${response.data.message}`);
    console.log(`  Tenant ID: ${tenantId}`);
    console.log(`  Apartment: ${apartmentId}\n`);

    // Connect Socket.IO
    socket = io(BROKER_URL);

    socket.on('connect', () => {
      console.log(`🔌 Connected to broker\n`);
      socket.emit('join_room', tenantId);
    });

    socket.on('complaint_received', (data) => {
      displayFlashingAlert(data.strikeCount);
    });

    socket.on('disconnect', () => {
      console.log('✗ Disconnected from broker');
    });

    showMenu();
    tenantPrompt();
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 
                     error.response?.data?.message ||
                     error.response?.statusText ||
                     error.message ||
                     'Unknown error';
    console.error(`✗ Login failed: ${errorMsg}\n`);
    rl.close();
    process.exit(1);
  }
};

const showMenu = () => {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Tenant: ${tenantName}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  c <tenant-id> <msg>  - File complaint`);
  console.log(`  s <tenant-id>        - View strikes`);
  console.log(`  q                    - Quit`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
};

const tenantPrompt = async () => {
  const input = await question('> ');
  const parts = input.trim().split(' ');
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case 'c':
      if (parts.length < 3) {
        console.log('Usage: c <tenant-id> <message>\n');
      } else {
        const targetTenantId = parts[1];
        const message = parts.slice(2).join(' ');
        await fileComplaint(targetTenantId, message);
      }
      break;
    case 's':
      if (parts.length < 2) {
        console.log('Usage: s <tenant-id>\n');
      } else {
        await viewStrikes(parts[1]);
      }
      break;
    case 'q':
      console.log('\nShutting down...');
      socket?.close();
      rl.close();
      process.exit(0);
    default:
      console.log('Unknown command\n');
  }

  tenantPrompt();
};

const fileComplaint = async (targetTenantId: string, content: string) => {
  try {
    const response = await api.post('/complaint', {
      tenantId: targetTenantId,
      content,
    });
    console.log(`✓ Complaint filed (Strikes: ${response.data.strikeCount})\n`);
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 
                     error.response?.data?.message ||
                     error.response?.statusText ||
                     error.message ||
                     'Unknown error';
    console.error(`✗ Failed: ${errorMsg}\n`);
  }
};

const viewStrikes = async (tenantIdToCheck: string) => {
  try {
    const response = await api.get(`/strikes/${tenantIdToCheck}`);
    console.log(`📊 Strikes: ${response.data.strikeCount}\n`);
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 
                     error.response?.data?.message ||
                     error.response?.statusText ||
                     error.message ||
                     'Unknown error';
    console.error(`✗ Failed: ${errorMsg}\n`);
  }
};

// ============ START ============
console.log(chalk.cyan(`\n╔════════════════════════════════════╗`));
console.log(chalk.cyan(`║   🏠 ShushNet Tenant Client 🏠    ║`));
console.log(chalk.cyan(`╚════════════════════════════════════╝\n`));

tenantLogin();

process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  socket?.close();
  rl.close();
  process.exit(0);
});
