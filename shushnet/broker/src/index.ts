import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import dotenv from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';
import { connectDB } from './db';
import { Apartment } from './models/Apartment';
import { Complaint } from './models/Complaint';
import { Strike } from './models/Strike';
import { validateRegisterTenant, validateTenantLogin, validateComplaint } from './validators';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE'],
  },
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
  res.json({ status: 'Broker running ✓' });
});

// ============ MANAGER: REGISTER TENANT ============
app.post('/manager/register-tenant', async (req, res) => {
  try {
    if (!validateRegisterTenant(req.body)) {
      return res.status(400).json({
        error: 'Invalid payload. Required: apartmentId, managerName, tenantName',
      });
    }

    const { apartmentId, managerName, tenantName } = req.body;

    // Check if tenant name already registered
    const existing = await Apartment.findOne({
      tenantName: tenantName.toLowerCase().trim(),
    });
    if (existing) {
      return res.status(409).json({ error: `Tenant "${tenantName}" already registered` });
    }

    // Generate unique tenant ID
    const tenantId = `tenant-${crypto.randomBytes(4).toString('hex')}`;

    // Create apartment record
    const apt = new Apartment({
      apartmentId,
      managerName,
      tenantName: tenantName.toLowerCase().trim(),
      tenantId,
    });

    await apt.save();

    console.log(`✓ Tenant registered: ${tenantName} (ID: ${tenantId}) in ${apartmentId}`);

    res.status(201).json({
      success: true,
      message: `Tenant "${tenantName}" registered successfully`,
      tenantId,
      apartmentId,
    });
  } catch (error) {
    console.error('Register tenant error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ============ TENANT: LOGIN ============
app.post('/tenant/login', async (req, res) => {
  try {
    if (!validateTenantLogin(req.body)) {
      return res.status(400).json({
        error: 'Invalid payload. Required: tenantName (string)',
      });
    }

    const { tenantName } = req.body;

    // Check if tenant exists
    const apt = await Apartment.findOne({
      tenantName: tenantName.toLowerCase().trim(),
    });

    if (!apt) {
      return res.status(404).json({
        error: `Tenant "${tenantName}" not registered. Ask your manager to register you.`,
      });
    }

    console.log(`✓ Tenant login: ${tenantName} (ID: ${apt.tenantId})`);

    res.status(200).json({
      success: true,
      message: `Welcome ${tenantName}!`,
      tenantId: apt.tenantId,
      apartmentId: apt.apartmentId,
    });
  } catch (error) {
    console.error('Tenant login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============ MANAGER: DELETE TENANT ============
app.delete('/manager/tenant/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const apt = await Apartment.findOneAndDelete({ tenantId });

    if (!apt) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Also delete related strikes
    await Strike.deleteOne({ tenantId });

    console.log(`✓ Tenant deleted: ${apt.tenantName} (ID: ${tenantId})`);

    res.json({
      success: true,
      message: `Tenant "${apt.tenantName}" deleted`,
    });
  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({ error: 'Deletion failed' });
  }
});

// ============ FILE COMPLAINT ============
app.post('/complaint', async (req, res) => {
  try {
    if (!validateComplaint(req.body)) {
      return res.status(400).json({
        error: 'Invalid payload. Required: tenantId (string), content (string)',
      });
    }

    const { tenantId, content } = req.body;

    // Verify tenant exists
    const apt = await Apartment.findOne({ tenantId });
    if (!apt) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Create complaint
    const complaint = new Complaint({
      tenantId,
      apartmentId: apt.apartmentId,
      content,
      timestamp: new Date(),
    });

    await complaint.save();

    // Increment strike count
    let strike = await Strike.findOne({ tenantId });
    if (!strike) {
      strike = new Strike({
        tenantId,
        apartmentId: apt.apartmentId,
        count: 1,
        lastStrikeTime: new Date(),
      });
    } else {
      strike.count += 1;
      strike.lastStrikeTime = new Date();
    }
    await strike.save();

    console.log(`📝 Complaint filed against ${apt.tenantName} (Strike: ${strike.count})`);

    // Check for 3-strike escalation
    if (strike.count === 3) {
      try {
        await axios.post('http://localhost:3001/escalate', {
          apartmentId: apt.apartmentId,
          strikeCount: 3,
          tenantName: apt.tenantName,
          tenantId: tenantId,
        });
        console.log(`  🚨 ESCALATION: 3 strikes reached! Webhook sent to Building Manager`);
      } catch (error) {
        console.error(`  ⚠️  Failed to send escalation webhook:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }

    // Emit to Socket.IO room
    const roomSize = io.sockets.adapter.rooms.get(tenantId)?.size || 0;
    io.to(tenantId).emit('complaint_received', {
      complaintId: complaint._id,
      strikeCount: strike.count,
      timestamp: complaint.timestamp,
    });

    if (roomSize > 0) {
      console.log(`  🔔 Alert sent to ${roomSize} client(s)`);
    } else {
      console.log(`  ⚠️  No clients listening (will receive on next connection)`);
    }

    res.status(201).json({
      success: true,
      message: 'Complaint filed',
      complaint: {
        _id: complaint._id,
        tenantId: complaint.tenantId,
        timestamp: complaint.timestamp,
      },
      strikeCount: strike.count,
    });
  } catch (error) {
    console.error('Complaint error:', error);
    res.status(500).json({ error: 'Failed to file complaint' });
  }
});

// ============ GET STRIKES ============
app.get('/strikes/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const strike = await Strike.findOne({ tenantId });

    if (!strike) {
      return res.json({ tenantId, strikeCount: 0 });
    }

    res.json({
      tenantId,
      strikeCount: strike.count,
      lastStrikeTime: strike.lastStrikeTime,
    });
  } catch (error) {
    console.error('Get strikes error:', error);
    res.status(500).json({ error: 'Failed to retrieve strikes' });
  }
});

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
  console.log(`✓ Socket.IO client connected: ${socket.id}`);

  // Join room by tenant ID
  socket.on('join_room', (tenantId: string) => {
    socket.join(tenantId);
    const roomSize = io.sockets.adapter.rooms.get(tenantId)?.size || 1;
    console.log(`  → Client ${socket.id} joined tenant room: ${tenantId} (size: ${roomSize})`);
  });

  socket.on('disconnect', () => {
    console.log(`✗ Socket.IO client disconnected: ${socket.id}`);
  });
});

// ============ START SERVER ============
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`\n🚀 Broker running on http://localhost:${PORT}`);
      console.log(`📡 Socket.IO ready for connections`);
      console.log(`\n📚 Manager Endpoints:`);
      console.log(`   POST /manager/register-tenant    - Register tenant`);
      console.log(`   DELETE /manager/tenant/:tenantId - Delete tenant`);
      console.log(`\n📚 Tenant Endpoints:`);
      console.log(`   POST /tenant/login               - Login with name`);
      console.log(`   POST /complaint                  - File complaint`);
      console.log(`   GET  /strikes/:tenantId          - View strikes\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
