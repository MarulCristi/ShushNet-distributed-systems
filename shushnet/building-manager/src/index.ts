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

app.use(express.json());

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

app.get('/health', (req, res) => {
  res.json({ status: 'Building Manager is running' });
});

app.post('/escalate', (req, res) => {
  const { apartmentId, strikeCount, residentName } = req.body;

  if (!apartmentId || !strikeCount) {
    return res.status(400).json({ error: 'Missing apartmentId or strikeCount' });
  }

  const residentSuffix =
    typeof residentName === 'string' && residentName.trim().length > 0
      ? ` (Resident: ${residentName.trim()})`
      : '';
  console.log(`\nESCALATION: Apartment ${apartmentId}${residentSuffix} reached ${strikeCount} strikes`);

  const timestamp = new Date().toISOString();
  const residentLogPart =
    typeof residentName === 'string' && residentName.trim().length > 0
      ? `, Resident: ${residentName.trim()}`
      : '';
  const logEntry = `[${timestamp}] Escalation - Apartment: ${apartmentId}${residentLogPart}, Strikes: ${strikeCount}\n`;

  fs.appendFileSync(path.join(logsDir, 'escalation.log'), logEntry);

  res.json({
    success: true,
    message: `Escalation logged for ${apartmentId}`,
    timestamp,
  });
});

app.get('/escalations', (req, res) => {
  try {
    const logPath = path.join(logsDir, 'escalation.log');
    if (!fs.existsSync(logPath)) {
      return res.json({ escalations: [] });
    }

    const logs = fs
      .readFileSync(logPath, 'utf-8')
      .trim()
      .split('\n')
      .filter((line) => line);

    res.json({ escalations: logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read escalations' });
  }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

interface StrikeComplaint {
  content: string;
  timestamp: string;
}

interface ApartmentStrikes {
  apartmentId: number;
  residentName: string | null;
  strikeCount: number;
  complaints: StrikeComplaint[];
}

interface AllStrikesResponse {
  apartments: ApartmentStrikes[];
}

interface SingleApartmentStrikesResponse {
  apartmentId: number;
  residentName: string | null;
  strikeCount: number;
  complaints: StrikeComplaint[];
}

const parseApartmentId = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const apartmentId = Number(value.trim());
  if (!Number.isInteger(apartmentId) || apartmentId <= 0) {
    return null;
  }

  return apartmentId;
};

let managerName = '';

const managerSetup = async () => {
  managerName = await question('Enter manager name: ');

  console.log('\nManager setup complete');
  console.log(`  Manager: ${managerName}\n`);

  showMenu();
  managerPrompt();
};

const showMenu = () => {
  console.log('\n----------------------------------');
  console.log(`  Manager: ${managerName}`);
  console.log('----------------------------------');
  console.log('  r <apartment-number> <resident-name> - Register apartment account');
  console.log('  d <apartment-number> - Delete apartment account');
  console.log('  s [apartment-number] - View complaints (all or specific apartment)');
  console.log('  q                    - Quit');
  console.log('----------------------------------\n');
};

const managerPrompt = async (): Promise<void> => {
  const input = await question('> ');
  const parts = input.trim().split(' ');
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case 'r': {
      if (parts.length < 3) {
        console.log('Usage: r <apartment-number> <resident-name>\n');
        break;
      }

      const apartmentId = parseApartmentId(parts[1]);
      if (apartmentId === null) {
        console.log('Apartment number must be a positive integer.\n');
        break;
      }

      const residentName = parts.slice(2).join(' ').trim();
      if (!residentName) {
        console.log('Resident name is required.\n');
        break;
      }

      await registerApartment(apartmentId, residentName);
      break;
    }
    case 'd': {
      if (parts.length !== 2) {
        console.log('Usage: d <apartment-number>\n');
        break;
      }

      const apartmentId = parseApartmentId(parts[1]);
      if (apartmentId === null) {
        console.log('Apartment number must be a positive integer.\n');
        break;
      }

      await deleteApartment(apartmentId);
      break;
    }
    case 'q':
      console.log('\nShutting down...');
      rl.close();
      process.exit(0);
    case 's':
      if (parts.length > 2) {
        console.log('Usage: s [apartment-number]\n');
        break;
      }

      if (parts.length === 1) {
        await viewAllComplaints();
        break;
      }

      const apartmentId = parseApartmentId(parts[1]);
      if (apartmentId === null) {
        console.log('Apartment number must be a positive integer.\n');
        break;
      }
      await viewApartmentComplaints(apartmentId);
      break;
    default:
      console.log('Unknown command\n');
  }

  managerPrompt();
};

const registerApartment = async (apartmentId: number, residentName: string) => {
  try {
    const response = await api.post('/manager/register-apartment', {
      apartmentId,
      managerName,
      residentName,
    });

    console.log('Apartment account registered');
    console.log(`  Apartment: ${response.data.apartmentId}`);
    console.log(`  Resident: ${residentName}`);
    console.log(`  Account ID: ${response.data.tenantId}\n`);
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

const deleteApartment = async (apartmentId: number) => {
  try {
    await api.delete(`/manager/apartment/${apartmentId}`);
    console.log(`Apartment ${apartmentId} deleted\n`);
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

const viewAllComplaints = async () => {
  try {
    const response = await api.get<AllStrikesResponse>('/strikes');
    const apartments = response.data.apartments || [];

    if (apartments.length === 0) {
      console.log('No apartments registered.\n');
      return;
    }

    console.log('All apartment complaints:');
    apartments.forEach((apartment) => {
      const residentSuffix = apartment.residentName ? ` (Resident: ${apartment.residentName})` : '';
      console.log(
        `  Apartment ${apartment.apartmentId}${residentSuffix} - Strikes: ${apartment.strikeCount}`
      );

      if (apartment.complaints.length === 0) {
        console.log('    No active complaints');
        return;
      }

      apartment.complaints.forEach((complaint, index) => {
        const receivedAt = new Date(complaint.timestamp).toLocaleString();
        console.log(`    ${index + 1}. [${receivedAt}] ${complaint.content}`);
      });
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

const viewApartmentComplaints = async (apartmentId: number) => {
  try {
    const response = await api.get<SingleApartmentStrikesResponse>(`/strikes/${apartmentId}`);
    const residentSuffix = response.data.residentName
      ? ` (Resident: ${response.data.residentName})`
      : '';

    console.log(
      `Apartment ${response.data.apartmentId}${residentSuffix} - Strikes: ${response.data.strikeCount}`
    );

    if (response.data.complaints.length === 0) {
      console.log('  No active complaints\n');
      return;
    }

    response.data.complaints.forEach((complaint, index) => {
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

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(chalk.cyan('\n+--------------------------------+'));
      console.log(chalk.cyan('|  ShushNet Manager CLI          |'));
      console.log(chalk.cyan('+--------------------------------+\n'));
      console.log(`Building Manager running on http://localhost:${PORT}`);
      console.log('Ready to receive escalations');
      console.log(`Escalation logs: ${logsDir}\n`);
    });

    setTimeout(() => {
      managerSetup();
    }, 500);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  rl.close();
  process.exit(0);
});
