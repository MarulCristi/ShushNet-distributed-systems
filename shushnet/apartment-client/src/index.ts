import { io } from 'socket.io-client';
import axios from 'axios';
import * as readline from 'readline';
import chalk from 'chalk';

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3000';
const api = axios.create({ baseURL: BROKER_URL });

let socket: ReturnType<typeof io>;
let accountId = '';
let apartmentId = 0;
let alertTimeout: NodeJS.Timeout | null = null;

interface ComplaintAlertPayload {
  strikeCount: number;
  content: string;
  timestamp: string;
  apartmentId?: number;
}

interface StrikeComplaint {
  content: string;
  timestamp: string;
}

interface StrikesResponse {
  strikeCount: number;
  complaints?: StrikeComplaint[];
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

const parseApartmentId = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const id = Number(value.trim());
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
};

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
};

const displayFlashingAlert = (payload: ComplaintAlertPayload) => {
  if (alertTimeout) clearTimeout(alertTimeout);

  let flashCount = 0;
  const maxFlashes = 6;
  const receivedAt = new Date(payload.timestamp).toLocaleString();
  const targetLine = `Apartment: ${payload.apartmentId ?? apartmentId}`;
  const strikeLine = `Strikes: ${payload.strikeCount}`;
  const timestampLine = `Received: ${receivedAt}`;
  const reasonLine = `Reason: ${truncateText(payload.content, 25)}`;

  const showAlert = () => {
    if (flashCount % 2 === 0) {
      console.clear();
      console.log(
        chalk.bgRed.black.bold(`
+-----------------------------------+
|               ALERT               |
| Complaint Filed Against You!      |
| ${targetLine.padEnd(33)} |
| ${strikeLine.padEnd(33)} |
| ${timestampLine.padEnd(33)} |
| ${reasonLine.padEnd(33)} |
+-----------------------------------+
`)
      );
    } else {
      console.clear();
      console.log(chalk.black(`
+-----------------------------------+
|                                   |
|                                   |
|                                   |
|                                   |
|                                   |
|                                   |
+-----------------------------------+
`));
    }

    flashCount += 1;
    if (flashCount < maxFlashes) {
      alertTimeout = setTimeout(showAlert, 300);
    } else {
      console.clear();
      showMenu();
    }
  };

  showAlert();
};

const tenantLogin = async () => {
  const apartmentInput = await question('Enter your apartment number: ');
  const apartmentIdToLogin = parseApartmentId(apartmentInput);

  if (apartmentIdToLogin === null) {
    console.error('Apartment number must be a positive integer.');
    rl.close();
    process.exit(1);
  }

  try {
    const response = await api.post('/tenant/login', { apartmentId: apartmentIdToLogin });
    accountId = response.data.tenantId;
    apartmentId = response.data.apartmentId;

    console.log(`\n${response.data.message}`);
    console.log(`  Apartment Number: ${apartmentId}`);
    if (response.data.residentName) {
      console.log(`  Resident: ${response.data.residentName}`);
    }
    console.log(`  Account ID: ${accountId}\n`);

    socket = io(BROKER_URL);

    socket.on('connect', () => {
      console.log('Connected to broker\n');
      socket.emit('join_room', accountId);
    });

    socket.on('complaint_received', (data) => {
      displayFlashingAlert(data as ComplaintAlertPayload);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from broker');
    });

    showMenu();
    tenantPrompt();
  } catch (error: any) {
    const errorMsg =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.response?.statusText ||
      error.message ||
      'Unknown error';
    console.error(`Login failed: ${errorMsg}\n`);
    rl.close();
    process.exit(1);
  }
};

const showMenu = () => {
  console.log('\n----------------------------------');
  console.log(`  Apartment Account: ${apartmentId}`);
  console.log('----------------------------------');
  console.log('  c <apartment-number> <msg> - File complaint');
  console.log('  s                          - View strikes against your apartment');
  console.log('  q                      - Quit');
  console.log('----------------------------------\n');
};

const tenantPrompt = async (): Promise<void> => {
  const input = await question('> ');
  const parts = input.trim().split(' ');
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case 'c': {
      if (parts.length < 3) {
        console.log('Usage: c <apartment-number> <message>\n');
        break;
      }

      const targetApartmentId = parseApartmentId(parts[1]);
      if (targetApartmentId === null) {
        console.log('Apartment number must be a positive integer.\n');
        break;
      }

      const message = parts.slice(2).join(' ');
      await fileComplaint(targetApartmentId, message);
      break;
    }
    case 's': {
      if (parts.length !== 1) {
        console.log('Usage: s\n');
        break;
      }

      await viewStrikes(apartmentId);
      break;
    }
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

const fileComplaint = async (targetApartmentId: number, content: string) => {
  try {
    const response = await api.post('/complaint', {
      apartmentId: targetApartmentId,
      content,
    });
    console.log(`Complaint filed (Strikes: ${response.data.strikeCount})\n`);
  } catch (error: any) {
    const errorMsg =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.response?.statusText ||
      error.message ||
      'Unknown error';
    console.error(`Failed: ${errorMsg}\n`);
  }
};

const viewStrikes = async (targetApartmentId: number) => {
  try {
    const response = await api.get<StrikesResponse>('/complaints/summary', {
      params: { apartmentId: targetApartmentId },
    });
    const complaintList = response.data.complaints || [];

    console.log(`Strikes for apartment number ${targetApartmentId}: ${response.data.strikeCount}`);

    if (complaintList.length === 0) {
      console.log('No active complaints.\n');
      return;
    }

    console.log('Strike list:');
    complaintList.forEach((complaint, index) => {
      const receivedAt = new Date(complaint.timestamp).toLocaleString();
      console.log(`  ${index + 1}. [${receivedAt}] ${complaint.content}`);
    });
    console.log('');
  } catch (error: any) {
    const errorMsg =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.response?.statusText ||
      error.message ||
      'Unknown error';
    console.error(`Failed: ${errorMsg}\n`);
  }
};

console.log(chalk.cyan('\n+--------------------------------+'));
console.log(chalk.cyan('|   ShushNet Tenant Client       |'));
console.log(chalk.cyan('+--------------------------------+\n'));

tenantLogin();

process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  socket?.close();
  rl.close();
  process.exit(0);
});
