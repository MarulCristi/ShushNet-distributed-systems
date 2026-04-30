import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import dotenv from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';
import { connectDB } from './db';
import { Apartment } from './models/Apartment';
import { Complaint } from './models/Complaint';
import { validateRegisterApartment, validateTenantLogin, validateComplaint } from './validators';

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

const corsConfig = {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
};

app.use(cors(corsConfig));
app.options('*', cors(corsConfig));
app.use(express.json());

const toApartmentId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
};

const getApartmentComplaintSummaries = async () => {
  const apartments = await Apartment.find({})
    .select('apartmentId residentName')
    .sort({ apartmentId: 1 })
    .lean();

  const complaints = await Complaint.find({})
    .sort({ apartmentId: 1, timestamp: -1 })
    .select('apartmentId content timestamp')
    .lean();

  const complaintsByApartment = new Map<number, Array<{ content: string; timestamp: Date }>>();
  complaints.forEach((entry) => {
    if (!complaintsByApartment.has(entry.apartmentId)) {
      complaintsByApartment.set(entry.apartmentId, []);
    }
    complaintsByApartment.get(entry.apartmentId)?.push({
      content: entry.content,
      timestamp: entry.timestamp,
    });
  });

  return apartments.map((apartment) => {
    const apartmentComplaints = complaintsByApartment.get(apartment.apartmentId) || [];
    return {
      apartmentId: apartment.apartmentId,
      residentName: apartment.residentName || null,
      strikeCount: apartmentComplaints.length,
      lastStrikeTime: apartmentComplaints[0]?.timestamp || null,
      complaints: apartmentComplaints,
    };
  });
};

app.get('/health', (req, res) => {
  res.json({ status: 'Broker running' });
});

app.post('/manager/register-apartment', async (req, res) => {
  try {
    if (!validateRegisterApartment(req.body)) {
      return res.status(400).json({
        error: 'Invalid payload. Required: apartment number (number), managerName (string), residentName (optional string)',
      });
    }

    const apartmentId = toApartmentId(req.body.apartmentId);
    const managerName = String(req.body.managerName).trim();
    const residentName =
      typeof req.body.residentName === 'string' ? req.body.residentName.trim() : '';

    if (apartmentId === null) {
      return res.status(400).json({ error: 'apartment number must be a positive integer' });
    }

    const existing = await Apartment.findOne({ apartmentId });
    if (existing) {
      return res.status(409).json({ error: `Apartment ${apartmentId} is already registered` });
    }

    const tenantId = `tenant-${crypto.randomBytes(4).toString('hex')}`;

    const apt = new Apartment({
      apartmentId,
      managerName,
      tenantId,
      ...(residentName ? { residentName } : {}),
    });

    await apt.save();

    console.log(`Registered apartment ${apartmentId} (account: ${tenantId})`);

    res.status(201).json({
      success: true,
      message: `Apartment ${apartmentId} registered successfully`,
      tenantId,
      apartmentId,
    });
  } catch (error) {
    console.error('Register apartment error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/tenant/login', async (req, res) => {
  try {
    if (!validateTenantLogin(req.body)) {
      return res.status(400).json({
        error: 'Invalid payload. Required: apartment number (number)',
      });
    }

    const apartmentId = toApartmentId(req.body.apartmentId);

    if (apartmentId === null) {
      return res.status(400).json({ error: 'apartment number must be a positive integer' });
    }

    const apt = await Apartment.findOne({ apartmentId });

    if (!apt) {
      return res.status(404).json({
        error: `Apartment ${apartmentId} is not registered. Ask your manager to register it.`,
      });
    }

    const residentSuffix = apt.residentName ? `, resident: ${apt.residentName}` : '';
    console.log(`Apartment login: ${apartmentId} (account: ${apt.tenantId}${residentSuffix})`);

    res.status(200).json({
      success: true,
      message: `Welcome apartment ${apartmentId}!`,
      tenantId: apt.tenantId,
      apartmentId: apt.apartmentId,
      residentName: apt.residentName || null,
    });
  } catch (error) {
    console.error('Tenant login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.delete('/manager/apartment/:apartmentId', async (req, res) => {
  try {
    const apartmentId = toApartmentId(req.params.apartmentId);
    if (apartmentId === null) {
      return res.status(400).json({ error: 'apartment number must be a positive integer' });
    }

    const apt = await Apartment.findOneAndDelete({ apartmentId });

    if (!apt) {
      return res.status(404).json({ error: `Apartment ${apartmentId} not found` });
    }

    await Complaint.deleteMany({ apartmentId });

    console.log(`Deleted apartment ${apartmentId}`);

    res.json({
      success: true,
      message: `Apartment ${apartmentId} deleted`,
    });
  } catch (error) {
    console.error('Delete apartment error:', error);
    res.status(500).json({ error: 'Deletion failed' });
  }
});

app.post('/complaint', async (req, res) => {
  try {
    if (!validateComplaint(req.body)) {
      return res.status(400).json({
        error: 'Invalid payload. Required: apartment number (number), content (string)',
      });
    }

    const apartmentId = toApartmentId(req.body.apartmentId);
    const authorApartmentId =
      req.body.authorApartmentId === undefined ? null : toApartmentId(req.body.authorApartmentId);
    const content = String(req.body.content).trim();

    if (apartmentId === null) {
      return res.status(400).json({ error: 'apartment number must be a positive integer' });
    }
    if (req.body.authorApartmentId !== undefined && authorApartmentId === null) {
      return res.status(400).json({ error: 'author apartment number must be a positive integer' });
    }
    if (authorApartmentId !== null && authorApartmentId === apartmentId) {
      return res.status(400).json({ error: 'You cannot file a complaint against your own apartment.' });
    }

    const apt = await Apartment.findOne({ apartmentId });
    if (!apt) {
      return res.status(404).json({ error: `Apartment ${apartmentId} not found` });
    }
    if (authorApartmentId !== null) {
      const authorApartment = await Apartment.findOne({ apartmentId: authorApartmentId });
      if (!authorApartment) {
        return res.status(404).json({ error: `Author apartment ${authorApartmentId} not found` });
      }
    }

    const complaint = new Complaint({
      apartmentId: apt.apartmentId,
      ...(authorApartmentId !== null ? { authorApartmentId } : {}),
      content,
      timestamp: new Date(),
    });

    await complaint.save();

    const strikeCount = await Complaint.countDocuments({ apartmentId: apt.apartmentId });

    console.log(`Complaint filed against apartment ${apt.apartmentId} (Strike: ${strikeCount})`);

    if (strikeCount === 3) {
      try {
        await axios.post('http://localhost:3001/escalate', {
          apartmentId: apt.apartmentId,
          strikeCount: 3,
          tenantId: apt.tenantId,
          residentName: apt.residentName || null,
        });
        console.log('Escalation webhook sent to Building Manager');
      } catch (error) {
        console.error('Failed to send escalation webhook:', error instanceof Error ? error.message : 'Unknown error');
      }
    }

    const roomSize = io.sockets.adapter.rooms.get(apt.tenantId)?.size || 0;
    io.to(apt.tenantId).emit('complaint_received', {
      complaintId: complaint._id,
      content: complaint.content,
      strikeCount,
      timestamp: complaint.timestamp,
      apartmentId: apt.apartmentId,
    });

    if (roomSize > 0) {
      console.log(`Alert sent to ${roomSize} client(s)`);
    } else {
      console.log('No clients listening (will receive on next connection)');
    }

    res.status(201).json({
      success: true,
      message: 'Complaint filed',
      complaint: {
        _id: complaint._id,
        apartmentId: complaint.apartmentId,
        timestamp: complaint.timestamp,
      },
      strikeCount,
    });
  } catch (error) {
    console.error('Complaint error:', error);
    res.status(500).json({ error: 'Failed to file complaint' });
  }
});

app.get('/strikes/:apartmentId', async (req, res) => {
  try {
    const apartmentId = toApartmentId(req.params.apartmentId);
    if (apartmentId === null) {
      return res.status(400).json({ error: 'apartment number must be a positive integer' });
    }

    const apartment = await Apartment.findOne({ apartmentId }).select('residentName').lean();
    if (!apartment) {
      return res.status(404).json({ error: `Apartment ${apartmentId} not found` });
    }

    const complaints = await Complaint.find({ apartmentId })
      .sort({ timestamp: -1 })
      .select('content timestamp')
      .lean();

    if (complaints.length === 0) {
      return res.json({
        apartmentId,
        residentName: apartment.residentName || null,
        strikeCount: 0,
        complaints: [],
      });
    }

    res.json({
      apartmentId,
      residentName: apartment.residentName || null,
      strikeCount: complaints.length,
      lastStrikeTime: complaints[0]?.timestamp || null,
      complaints: complaints.map((entry) => ({
        content: entry.content,
        timestamp: entry.timestamp,
      })),
    });
  } catch (error) {
    console.error('Get strikes error:', error);
    res.status(500).json({ error: 'Failed to retrieve strikes' });
  }
});

app.get('/strikes', async (req, res) => {
  try {
    const data = await getApartmentComplaintSummaries();

    res.json({ apartments: data });
  } catch (error) {
    console.error('Get all strikes error:', error);
    res.status(500).json({ error: 'Failed to retrieve strike list' });
  }
});

app.get('/complaints/summary', async (req, res) => {
  try {
    const apartmentId = req.query.apartmentId ? toApartmentId(req.query.apartmentId) : null;
    if (req.query.apartmentId && apartmentId === null) {
      return res.status(400).json({ error: 'apartment number must be a positive integer' });
    }

    const data = await getApartmentComplaintSummaries();
    if (apartmentId !== null) {
      const apartmentData = data.find((entry) => entry.apartmentId === apartmentId);
      if (!apartmentData) {
        return res.status(404).json({ error: `Apartment ${apartmentId} not found` });
      }
      return res.json(apartmentData);
    }

    return res.json({ apartments: data });
  } catch (error) {
    console.error('Get complaints summary error:', error);
    return res.status(500).json({ error: 'Failed to retrieve complaints summary' });
  }
});

app.get('/complaints', async (req, res) => {
  try {
    const apartmentId = req.query.apartmentId ? toApartmentId(req.query.apartmentId) : null;
    const authorApartmentId = req.query.authorApartmentId ? toApartmentId(req.query.authorApartmentId) : null;
    const includeAuthors = req.query.includeAuthors === '1' || req.query.includeAuthors === 'true';
    if (req.query.apartmentId && apartmentId === null) {
      return res.status(400).json({ error: 'apartment number must be a positive integer' });
    }
    if (req.query.authorApartmentId && authorApartmentId === null) {
      return res.status(400).json({ error: 'author apartment number must be a positive integer' });
    }

    const filter: { apartmentId?: number; authorApartmentId?: number } = {};
    if (apartmentId !== null) {
      filter.apartmentId = apartmentId;
    }
    if (authorApartmentId !== null) {
      filter.authorApartmentId = authorApartmentId;
    }
    const complaints = await Complaint.find(filter)
      .sort({ timestamp: -1 })
      .select('apartmentId authorApartmentId content timestamp')
      .lean();

    const apartmentIds = [
      ...new Set(
        complaints.flatMap((item) =>
          item.authorApartmentId !== undefined
            ? [item.apartmentId, item.authorApartmentId]
            : [item.apartmentId]
        )
      ),
    ];
    const apartments = await Apartment.find({ apartmentId: { $in: apartmentIds } })
      .select('apartmentId residentName')
      .lean();
    const apartmentMeta = new Map<number, { residentName: string | null }>();
    apartments.forEach((apartment) => {
      apartmentMeta.set(apartment.apartmentId, {
        residentName: apartment.residentName || null,
      });
    });

    const enriched = complaints.map((complaint) => ({
      apartmentId: complaint.apartmentId,
      residentName: apartmentMeta.get(complaint.apartmentId)?.residentName ?? null,
      content: complaint.content,
      timestamp: complaint.timestamp,
      ...(includeAuthors
        ? {
            authorApartmentId: complaint.authorApartmentId ?? null,
            authorResidentName:
              complaint.authorApartmentId !== undefined
                ? apartmentMeta.get(complaint.authorApartmentId)?.residentName ?? null
                : null,
          }
        : {}),
    }));

    return res.json({ complaints: enriched });
  } catch (error) {
    console.error('Get complaints error:', error);
    return res.status(500).json({ error: 'Failed to retrieve complaints' });
  }
});

io.on('connection', (socket) => {
  console.log(`Socket.IO client connected: ${socket.id}`);

  socket.on('join_room', (tenantId: string) => {
    socket.join(tenantId);
    const roomSize = io.sockets.adapter.rooms.get(tenantId)?.size || 1;
    console.log(`Client ${socket.id} joined account room: ${tenantId} (size: ${roomSize})`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket.IO client disconnected: ${socket.id}`);
  });
});

const startServer = async () => {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log(`\nBroker running on http://localhost:${PORT}`);
      console.log('Socket.IO ready for connections');
      console.log('\nManager Endpoints:');
      console.log('   POST /manager/register-apartment      - Register apartment account');
      console.log('   DELETE /manager/apartment/:apartmentId - Delete apartment account');
      console.log('\nTenant Endpoints:');
      console.log('   POST /tenant/login                    - Login with apartment number');
      console.log('   POST /complaint                       - File complaint against apartment');
      console.log('   GET  /complaints                      - View complaints list');
      console.log('   GET  /complaints/summary              - View per-apartment complaint summaries');
      console.log('   GET  /strikes                         - View all apartment strikes');
      console.log('   GET  /strikes/:apartmentId            - View strikes\n');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
