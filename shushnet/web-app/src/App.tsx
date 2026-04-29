import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, WheelEvent } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import './App.css';

type Role = 'manager' | 'tenant';
type ViewStep = 1 | 2 | 3;

interface ApartmentStrikeSummary {
  apartmentId: number;
  residentName: string | null;
  strikeCount: number;
  complaints: Array<{ content: string; timestamp: string }>;
}

interface ComplaintsResponseItem {
  apartmentId: number;
  residentName: string | null;
  authorApartmentId?: number | null;
  authorResidentName?: string | null;
  content: string;
  timestamp: string;
}

interface ComplaintAlertPayload {
  strikeCount: number;
  content: string;
  timestamp: string;
  apartmentId?: number;
}

interface TenantSession {
  apartmentId: number;
  tenantId: string;
  residentName: string | null;
}

interface SimpleComplaintItem {
  content: string;
  timestamp: string;
}

interface SignedProfile {
  role: Role;
  name: string;
}

const brokerUrl = import.meta.env.VITE_BROKER_URL || 'http://localhost:3000';
const api = axios.create({ baseURL: brokerUrl });

const parseApartmentNumber = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const formatDate = (value: string): string => {
  return new Date(value).toLocaleString();
};

const GraphView = ({
  apartments,
  selectedApartment,
  onSelectApartment,
}: {
  apartments: ApartmentStrikeSummary[];
  selectedApartment: number | null;
  onSelectApartment: (apartmentId: number) => void;
}) => {
  const managerX = 500;
  const managerY = 310;
  const radius = 240;
  const [nodePositions, setNodePositions] = useState<Record<number, { x: number; y: number }>>({});
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragNodeId, setDragNodeId] = useState<number | null>(null);
  const [panStart, setPanStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const clamp = (value: number, min: number, max: number): number => {
    return Math.min(max, Math.max(min, value));
  };

  const getDefaultPosition = (index: number, total: number): { x: number; y: number } => {
    const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
    return {
      x: managerX + radius * Math.cos(angle),
      y: managerY + radius * Math.sin(angle),
    };
  };

  const isOverlapping = (
    candidate: { x: number; y: number },
    occupied: Array<{ x: number; y: number }>
  ): boolean => {
    const minNodeDistance = 74;
    return occupied.some((node) => {
      const deltaX = candidate.x - node.x;
      const deltaY = candidate.y - node.y;
      return Math.hypot(deltaX, deltaY) < minNodeDistance;
    });
  };

  const getNonOverlappingPosition = (
    index: number,
    total: number,
    occupied: Array<{ x: number; y: number }>
  ): { x: number; y: number } => {
    const baseTotal = Math.max(total, 1);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const ring = Math.floor(attempt / 16);
      const radiusOffset = ring * 66;
      const jitter = (attempt % 16) / 16;
      const angle = (Math.PI * 2 * (index + jitter)) / baseTotal - Math.PI / 2;
      const candidate = {
        x: managerX + (radius + radiusOffset) * Math.cos(angle),
        y: managerY + (radius + radiusOffset) * Math.sin(angle),
      };
      if (!isOverlapping(candidate, occupied)) {
        return candidate;
      }
    }
    return getDefaultPosition(index, total);
  };

  const getLocalPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }

    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const toWorldPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const local = getLocalPoint(clientX, clientY);
    if (!local) {
      return null;
    }

    return {
      x: (local.x - pan.x) / zoom,
      y: (local.y - pan.y) / zoom,
    };
  };

  useEffect(() => {
    setNodePositions((previous) => {
      const next: Record<number, { x: number; y: number }> = {};
      apartments.forEach((apartment, index) => {
        const existing = previous[apartment.apartmentId];
        if (existing) {
          next[apartment.apartmentId] = existing;
          return;
        }
        next[apartment.apartmentId] = getNonOverlappingPosition(index, apartments.length, Object.values(next));
      });
      return next;
    });
  }, [apartments]);

  useEffect(() => {
    if (dragNodeId === null && panStart === null) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      if (dragNodeId !== null) {
        const world = toWorldPoint(event.clientX, event.clientY);
        if (!world) {
          return;
        }

        setNodePositions((previous) => ({
          ...previous,
          [dragNodeId]: {
            x: world.x,
            y: world.y,
          },
        }));
        return;
      }

      if (panStart) {
        const deltaX = event.clientX - panStart.x;
        const deltaY = event.clientY - panStart.y;
        setPan({
          x: panStart.panX + deltaX,
          y: panStart.panY + deltaY,
        });
      }
    };

    const onMouseUp = () => {
      setDragNodeId(null);
      setPanStart(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragNodeId, panStart, pan, zoom]);

  const nodes = useMemo(() => {
    return apartments.map((apartment, index) => {
      const position = nodePositions[apartment.apartmentId] || getDefaultPosition(index, apartments.length);
      return {
        ...apartment,
        x: position.x,
        y: position.y,
      };
    });
  }, [apartments, nodePositions]);

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const local = getLocalPoint(event.clientX, event.clientY);
    if (!local) {
      return;
    }

    const scaleFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = clamp(zoom * scaleFactor, 0.5, 2.5);
    const worldX = (local.x - pan.x) / zoom;
    const worldY = (local.y - pan.y) / zoom;

    setZoom(nextZoom);
    setPan({
      x: local.x - worldX * nextZoom,
      y: local.y - worldY * nextZoom,
    });
  };

  const onZoomIn = () => {
    setZoom((previous) => clamp(previous * 1.15, 0.5, 2.5));
  };

  const onZoomOut = () => {
    setZoom((previous) => clamp(previous * 0.87, 0.5, 2.5));
  };

  return (
    <section className="panel graph-panel">
      <header className="panel-header">
        <h2>Network Graph</h2>
        <p>Drag nodes. Scroll to zoom. Drag empty space to pan.</p>
      </header>
      <svg
        ref={svgRef}
        className="network-graph"
        viewBox="0 0 1000 620"
        role="img"
        aria-label="Building graph"
        onWheel={onWheel}
      >
        <defs>
          <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect
          className="graph-background"
          x={0}
          y={0}
          width={1000}
          height={620}
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            setPanStart({
              x: event.clientX,
              y: event.clientY,
              panX: pan.x,
              panY: pan.y,
            });
          }}
        />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {nodes.map((node) => (
            <line
              key={`edge-${node.apartmentId}`}
              x1={managerX}
              y1={managerY}
              x2={node.x}
              y2={node.y}
              className="graph-edge"
            />
          ))}

          <g className="graph-manager" transform={`translate(${managerX}, ${managerY})`}>
            <circle r="36" className="manager-node" />
            <text className="node-title" textAnchor="middle" dy="5">
              Manager
            </text>
          </g>

          {nodes.map((node) => {
            const selected = selectedApartment === node.apartmentId;
            return (
              <g
                key={`node-${node.apartmentId}`}
                className={`graph-apartment ${selected ? 'selected' : ''}`}
                transform={`translate(${node.x}, ${node.y})`}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  if (event.button !== 0) {
                    return;
                  }
                  onSelectApartment(node.apartmentId);
                  setDragNodeId(node.apartmentId);
                }}
              >
                <circle r="30" className="apartment-node" filter="url(#glow)" />
                <text className="node-title" textAnchor="middle" dy="-2">
                  #{node.apartmentId}
                </text>
                <text className="node-subtitle" textAnchor="middle" dy="14">
                  {node.strikeCount} strikes
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="graph-zoom-controls">
        <button type="button" onClick={onZoomIn} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={onZoomOut} aria-label="Zoom out">
          -
        </button>
      </div>
    </section>
  );
};

function App() {
  const [viewStep, setViewStep] = useState<ViewStep>(1);
  const [role, setRole] = useState<Role | null>(null);

  const [managerNameInput, setManagerNameInput] = useState('');
  const [registerApartmentNumber, setRegisterApartmentNumber] = useState('');
  const [registerResidentName, setRegisterResidentName] = useState('');

  const [tenantApartmentNumber, setTenantApartmentNumber] = useState('');
  const [tenantNameInput, setTenantNameInput] = useState('');
  const [tenantSession, setTenantSession] = useState<TenantSession | null>(null);
  const tenantSocketRef = useRef<Socket | null>(null);

  const [signedProfile, setSignedProfile] = useState<SignedProfile | null>(null);

  const [apartments, setApartments] = useState<ApartmentStrikeSummary[]>([]);
  const [complaintsList, setComplaintsList] = useState<ComplaintsResponseItem[]>([]);
  const [complaintsAgainstMe, setComplaintsAgainstMe] = useState<SimpleComplaintItem[]>([]);
  const [selectedApartment, setSelectedApartment] = useState<number | null>(null);
  const [complaintFilterApartment, setComplaintFilterApartment] = useState<number | null>(null);
  const [complaintTargetNumber, setComplaintTargetNumber] = useState('');
  const [complaintMessage, setComplaintMessage] = useState('');
  const [alerts, setAlerts] = useState<ComplaintAlertPayload[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentAlert = alerts[0] || null;

  const refreshApartmentGraph = async () => {
    const response = await api.get<{ apartments: ApartmentStrikeSummary[] }>('/complaints/summary');
    const apartmentData = response.data.apartments || [];
    setApartments(apartmentData);

    if (apartmentData.length > 0 && selectedApartment === null) {
      setSelectedApartment(apartmentData[0].apartmentId);
    }

    if (selectedApartment !== null && !apartmentData.some((item) => item.apartmentId === selectedApartment)) {
      setSelectedApartment(apartmentData.length > 0 ? apartmentData[0].apartmentId : null);
    }
  };

  const fetchComplaints = async (
    apartmentFilter?: number | null,
    options?: { authorApartmentId?: number | null; includeAuthors?: boolean }
  ) => {
    const params: Record<string, string | number> = {};
    if (apartmentFilter) {
      params.apartmentId = apartmentFilter;
    }
    if (options?.authorApartmentId) {
      params.authorApartmentId = options.authorApartmentId;
    }
    if (options?.includeAuthors) {
      params.includeAuthors = 1;
    }
    const response = await api.get<{ complaints: ComplaintsResponseItem[] }>('/complaints', { params });
    setComplaintsList(response.data.complaints || []);
  };

  const fetchComplaintsAgainstMe = async (apartmentId: number) => {
    const response = await api.get<{ complaints: ComplaintsResponseItem[] }>('/complaints', {
      params: { apartmentId },
    });
    const againstMe = (response.data.complaints || []).map((complaint) => ({
      content: complaint.content,
      timestamp: complaint.timestamp,
    }));
    setComplaintsAgainstMe(againstMe);
  };

  useEffect(() => {
    void refreshApartmentGraph();
    void fetchComplaints(undefined, { includeAuthors: role === 'manager' });
  }, []);

  useEffect(() => {
    return () => {
      tenantSocketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (viewStep !== 3) {
      return;
    }

    const syncGraphData = async () => {
      try {
        await refreshApartmentGraph();
        if (role === 'tenant' && tenantSession) {
          await fetchComplaintsAgainstMe(tenantSession.apartmentId);
        }
      } catch {
        // Keep the UI responsive while backend restarts; next cycle retries.
      }
    };

    void syncGraphData();
    const intervalId = window.setInterval(() => {
      void syncGraphData();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [viewStep, role, tenantSession]);

  const resetMessages = () => {
    setFeedback(null);
    setError(null);
  };

  const moveToStepTwo = (nextRole: Role) => {
    resetMessages();
    setRole(nextRole);
    setViewStep(2);
  };

  const startOver = () => {
    tenantSocketRef.current?.disconnect();
    tenantSocketRef.current = null;
    setTenantSession(null);
    setSignedProfile(null);
    setRole(null);
    setViewStep(1);
    setApartments([]);
    setComplaintsAgainstMe([]);
    setComplaintFilterApartment(null);
    setAlerts([]);
    setFeedback(null);
    setError(null);
    void fetchComplaints(undefined, { includeAuthors: false });
  };

  const handleManagerStepTwo = (event: FormEvent) => {
    event.preventDefault();
    resetMessages();

    const managerName = managerNameInput.trim();
    if (!managerName) {
      setError('Manager name is required.');
      return;
    }

    setSignedProfile({ role: 'manager', name: managerName });
    setViewStep(3);
    setFeedback(`Signed in as manager ${managerName}.`);
    setComplaintFilterApartment(null);
    void fetchComplaints(undefined, { includeAuthors: true });
  };

  const handleTenantStepTwo = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();

    const apartmentNumber = parseApartmentNumber(tenantApartmentNumber);
    if (apartmentNumber === null) {
      setError('Apartment number must be a positive integer.');
      return;
    }

    try {
      const response = await api.post('/tenant/login', { apartmentId: apartmentNumber });
      const session: TenantSession = {
        apartmentId: response.data.apartmentId,
        tenantId: response.data.tenantId,
        residentName: response.data.residentName || null,
      };

      const inputName = tenantNameInput.trim();
      const profileName = inputName || session.residentName || `Apartment #${session.apartmentId}`;

      setTenantSession(session);
      setSignedProfile({ role: 'tenant', name: profileName });
      setSelectedApartment(session.apartmentId);
      setComplaintTargetNumber('');
      setComplaintFilterApartment(null);
      setViewStep(3);
      setFeedback(`Signed in as apartment #${session.apartmentId}.`);

      tenantSocketRef.current?.disconnect();
      const socket = io(brokerUrl);
      tenantSocketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('join_room', session.tenantId);
      });

      socket.on('complaint_received', (alertData: ComplaintAlertPayload) => {
        setAlerts((previous) => [...previous, alertData]);
        void refreshApartmentGraph();
        void fetchComplaints(complaintFilterApartment, { includeAuthors: false });
        void fetchComplaintsAgainstMe(session.apartmentId);
      });

      await fetchComplaints(undefined, { includeAuthors: false });
      await fetchComplaintsAgainstMe(session.apartmentId);
    } catch (requestError: any) {
      const message =
        requestError.response?.data?.error ||
        requestError.response?.data?.message ||
        requestError.message ||
        'Login failed';
      setError(message);
    }
  };

  const handleRegisterApartment = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();

    const apartmentNumber = parseApartmentNumber(registerApartmentNumber);
    if (apartmentNumber === null) {
      setError('Apartment number must be a positive integer.');
      return;
    }

    const residentName = registerResidentName.trim();
    if (!residentName) {
      setError('Resident name is required.');
      return;
    }

    const managerName = signedProfile?.name?.trim() || managerNameInput.trim();
    if (!managerName) {
      setError('Manager profile is missing. Please sign in again.');
      return;
    }

    try {
      await api.post('/manager/register-apartment', {
        apartmentId: apartmentNumber,
        managerName,
        residentName,
      });
      setFeedback(`Apartment #${apartmentNumber} registered.`);
      setRegisterApartmentNumber('');
      setRegisterResidentName('');
      await refreshApartmentGraph();
      await fetchComplaints(complaintFilterApartment, { includeAuthors: true });
    } catch (requestError: any) {
      const message =
        requestError.response?.data?.error ||
        requestError.response?.data?.message ||
        requestError.message ||
        'Registration failed';
      setError(message);
    }
  };

  const handleEvictApartment = async () => {
    resetMessages();
    if (selectedApartment === null) {
      setError('Select an apartment to evict.');
      return;
    }

    try {
      await api.delete(`/manager/apartment/${selectedApartment}`);
      setFeedback(`Apartment #${selectedApartment} evicted.`);
      const nextFilter = complaintFilterApartment === selectedApartment ? null : complaintFilterApartment;
      setComplaintFilterApartment(nextFilter);
      await refreshApartmentGraph();
      await fetchComplaints(nextFilter, { includeAuthors: true });
    } catch (requestError: any) {
      const message =
        requestError.response?.data?.error ||
        requestError.response?.data?.message ||
        requestError.message ||
        'Failed to evict apartment';
      setError(message);
    }
  };

  const handleFileComplaint = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();

    const targetApartment = parseApartmentNumber(complaintTargetNumber);
    if (targetApartment === null) {
      setError('Target apartment number must be a positive integer.');
      return;
    }

    if (!complaintMessage.trim()) {
      setError('Complaint reason is required.');
      return;
    }
    if (tenantSession && targetApartment === tenantSession.apartmentId) {
      setError('You cannot file a complaint against your own apartment.');
      return;
    }

    try {
      await api.post('/complaint', {
        apartmentId: targetApartment,
        ...(tenantSession ? { authorApartmentId: tenantSession.apartmentId } : {}),
        content: complaintMessage.trim(),
      });
      setFeedback(`Complaint filed against apartment #${targetApartment}.`);
      setComplaintMessage('');
      await refreshApartmentGraph();
      await fetchComplaints(complaintFilterApartment, { includeAuthors: role === 'manager' });
      if (tenantSession) {
        await fetchComplaintsAgainstMe(tenantSession.apartmentId);
      }
    } catch (requestError: any) {
      const message =
        requestError.response?.data?.error ||
        requestError.response?.data?.message ||
        requestError.message ||
        'Failed to file complaint';
      setError(message);
    }
  };

  const setComplaintFilter = async (filterApartment: number | null) => {
    resetMessages();

    try {
      await fetchComplaints(filterApartment, { includeAuthors: role === 'manager' });
      setComplaintFilterApartment(filterApartment);
      if (filterApartment === null) {
        setFeedback('Showing complaints for all apartments.');
      } else {
        setFeedback(`Showing complaints for apartment #${filterApartment}.`);
      }
    } catch (requestError: any) {
      const message =
        requestError.response?.data?.error ||
        requestError.response?.data?.message ||
        requestError.message ||
        'Failed to load complaints';
      setError(message);
    }
  };

  const showMyComplaints = async () => {
    if (!tenantSession) {
      return;
    }
    resetMessages();
    try {
      await fetchComplaints(undefined, {
        authorApartmentId: tenantSession.apartmentId,
        includeAuthors: false,
      });
      setComplaintFilterApartment(null);
      setFeedback(`Showing complaints filed by apartment #${tenantSession.apartmentId}.`);
    } catch (requestError: any) {
      const message =
        requestError.response?.data?.error ||
        requestError.response?.data?.message ||
        requestError.message ||
        'Failed to load your complaints';
      setError(message);
    }
  };

  const selectedApartmentData =
    selectedApartment === null
      ? null
      : apartments.find((apartment) => apartment.apartmentId === selectedApartment) || null;

  const onDismissAlert = () => {
    setAlerts((previous) => previous.slice(1));
  };

  const renderViewOne = () => (
    <section className="panel step-card choose-role-card">
      <h2>Choose Role</h2>
      <p>Select how you want to enter the system.</p>
      <div className="role-buttons">
        <button type="button" onClick={() => moveToStepTwo('manager')}>
          Building Manager
        </button>
        <button type="button" onClick={() => moveToStepTwo('tenant')}>
          Apartment Tenant
        </button>
      </div>
    </section>
  );

  const renderViewTwo = () => {
    if (role === 'manager') {
      return (
        <section className="panel step-card sign-in-card">
          <h2>Manager Sign-In</h2>
          <p>Enter manager name to continue.</p>
          <form className="stack-form" onSubmit={handleManagerStepTwo}>
            <label>
              Manager Name
              <input
                value={managerNameInput}
                onChange={(event) => setManagerNameInput(event.target.value)}
                placeholder="e.g. Carla Ortega"
              />
            </label>
            <div className="actions-row">
              <button type="submit">Continue</button>
              <button type="button" onClick={startOver}>
                Back
              </button>
            </div>
          </form>
        </section>
      );
    }

    return (
      <section className="panel step-card sign-in-card">
        <h2>Tenant Sign-In</h2>
        <p>Enter apartment number and optional display name.</p>
        <form className="stack-form" onSubmit={handleTenantStepTwo}>
          <label>
            Apartment Number
            <input
              value={tenantApartmentNumber}
              onChange={(event) => setTenantApartmentNumber(event.target.value)}
              placeholder="e.g. 302"
            />
          </label>
          <label>
            Name (Optional)
            <input
              value={tenantNameInput}
              onChange={(event) => setTenantNameInput(event.target.value)}
              placeholder="e.g. Alex"
            />
          </label>
          <div className="actions-row">
            <button type="submit">Continue</button>
            <button type="button" onClick={startOver}>
              Back
            </button>
          </div>
        </form>
      </section>
    );
  };

  const renderSharedComplaintList = () => (
    <section className="panel complaints-panel">
      <header className="panel-header">
        <h2>Complaint List</h2>
        <p>Complaints from all users are visible. Filter by selected node if needed.</p>
      </header>

      <div className="actions-row">
        <button type="button" onClick={() => void setComplaintFilter(null)}>
          Show All Complaints
        </button>
        <button
          type="button"
          disabled={selectedApartment === null}
          onClick={() => {
            if (selectedApartment !== null) {
              void setComplaintFilter(selectedApartment);
            }
          }}
        >
          Show Selected Apartment
        </button>
        {role === 'tenant' && tenantSession && (
          <button type="button" onClick={() => void showMyComplaints()}>
            Show My Complaints
          </button>
        )}
      </div>

      <ul className="complaint-list">
        {complaintsList.map((complaint, index) => (
          <li key={`${complaint.apartmentId}-${complaint.timestamp}-${index}`}>
            <div className="complaint-top">
              <span>Apartment #{complaint.apartmentId}</span>
              <time>{formatDate(complaint.timestamp)}</time>
            </div>
            <p className="resident-line">Resident: {complaint.residentName || 'Unknown'}</p>
            {role === 'manager' && complaint.authorApartmentId && (
              <p className="resident-line">
                Filed by apartment #{complaint.authorApartmentId}
                {complaint.authorResidentName ? ` (${complaint.authorResidentName})` : ''}
              </p>
            )}
            <p>{complaint.content}</p>
          </li>
        ))}
        {complaintsList.length === 0 && <li className="empty">No complaints available.</li>}
      </ul>
    </section>
  );

  const renderViewThree = () => {
    if (role === 'manager') {
      return (
        <main className="layout-grid manager-layout">
          <GraphView
            apartments={apartments}
            selectedApartment={selectedApartment}
            onSelectApartment={(apartmentId) => {
              setSelectedApartment(apartmentId);
              void setComplaintFilter(apartmentId);
            }}
          />

          <section className="panel">
            <header className="panel-header">
              <h2>Apartment Registration</h2>
              <p>Add apartment nodes and resident profiles to the network.</p>
            </header>

            <form className="stack-form" onSubmit={handleRegisterApartment}>
              <label>
                Apartment Number
                <input
                  value={registerApartmentNumber}
                  onChange={(event) => setRegisterApartmentNumber(event.target.value)}
                  placeholder="e.g. 302"
                />
              </label>
              <label>
                Resident Name
                <input
                  value={registerResidentName}
                  onChange={(event) => setRegisterResidentName(event.target.value)}
                  placeholder="e.g. Alex Popescu"
                />
              </label>
              <button type="submit">Register Apartment</button>
            </form>

            <div className="selection-card">
              <h3>Selected Node</h3>
              {selectedApartmentData ? (
                <>
                  <p>Apartment #{selectedApartmentData.apartmentId}</p>
                  <p>Resident: {selectedApartmentData.residentName || 'Not set'}</p>
                  <p>Current strikes: {selectedApartmentData.strikeCount}</p>
                  <button type="button" className="danger-button" onClick={() => void handleEvictApartment()}>
                    Evict Apartment
                  </button>
                </>
              ) : (
                <p>Select an apartment node.</p>
              )}
            </div>
          </section>

          {renderSharedComplaintList()}
        </main>
      );
    }

    return (
      <main className="layout-grid tenant-layout">
        <GraphView
          apartments={apartments}
          selectedApartment={selectedApartment}
          onSelectApartment={(apartmentId) => {
            setSelectedApartment(apartmentId);
            setComplaintTargetNumber(String(apartmentId));
          }}
        />

        <section className="panel complaints-panel">
          <header className="panel-header">
            <h2>File Complaint</h2>
            <p>Select an apartment from graph or type number manually.</p>
          </header>

          <form className="stack-form" onSubmit={handleFileComplaint}>
            <label>
              Target Apartment Number
              <input
                value={complaintTargetNumber}
                onChange={(event) => setComplaintTargetNumber(event.target.value)}
                placeholder="e.g. 204"
                disabled={!tenantSession}
              />
            </label>
            <label>
              Complaint Reason
              <textarea
                value={complaintMessage}
                onChange={(event) => setComplaintMessage(event.target.value)}
                placeholder="Describe the complaint"
                rows={4}
                disabled={!tenantSession}
              />
            </label>
            <button type="submit" disabled={!tenantSession}>
              Submit Complaint
            </button>
          </form>

          <div className="selection-card">
            <h3>Your Apartment</h3>
            {tenantSession ? (
              <>
                <p>Apartment #{tenantSession.apartmentId}</p>
                <p>Resident: {tenantSession.residentName || signedProfile?.name || 'Unknown'}</p>
                <h3 className="against-me-title">Complaints Against Me</h3>
                <ul className="complaint-list complaint-list-compact">
                  {complaintsAgainstMe.map((complaint, index) => (
                    <li key={`${complaint.timestamp}-${index}`}>
                      <div className="complaint-top">
                        <span>Apartment #{tenantSession.apartmentId}</span>
                        <time>{formatDate(complaint.timestamp)}</time>
                      </div>
                      <p>{complaint.content}</p>
                    </li>
                  ))}
                  {complaintsAgainstMe.length === 0 && <li className="empty">No complaints against your apartment.</li>}
                </ul>
              </>
            ) : (
              <p>Tenant session not available.</p>
            )}
          </div>
        </section>

        {renderSharedComplaintList()}
      </main>
    );
  };

  return (
    <div className="app-shell">
      <div className="background-glow" />

      <header className={`top-bar panel ${viewStep === 3 ? 'top-bar-wide' : 'top-bar-compact'}`}>
        <div>
          <h1>ShushNet Control Deck</h1>
          <p>Broker-backed complaints network with manager and tenant web flows.</p>
          <p className="stepline">View {viewStep}: {viewStep === 1 ? 'Choose role' : viewStep === 2 ? 'Sign in' : 'Graph + complaints + form'}</p>
        </div>

        <div className="profile-area">
          {signedProfile ? (
            <div className="profile-chip">
              <span className="profile-role">{signedProfile.role === 'manager' ? 'Building Manager' : 'Apartment Tenant'}</span>
              <strong className="profile-name">{signedProfile.name}</strong>
            </div>
          ) : (
            <div className="profile-chip muted">
              <span className="profile-role">Not Signed In</span>
            </div>
          )}

          {viewStep > 1 && (
            <button type="button" className="logout-button" onClick={startOver}>
              Log out
            </button>
          )}
        </div>
      </header>

      {feedback && <div className="banner success">{feedback}</div>}
      {error && <div className={`banner error ${viewStep === 3 ? 'banner-wide' : 'banner-card-width'}`}>{error}</div>}

      {viewStep === 1 && renderViewOne()}
      {viewStep === 2 && renderViewTwo()}
      {viewStep === 3 && renderViewThree()}

      {currentAlert && (
        <div className="alert-overlay" role="dialog" aria-live="assertive">
          <div className="alert-box">
            <h3>Complaint Warning</h3>
            <p>Apartment #{currentAlert.apartmentId ?? tenantSession?.apartmentId} received a new complaint.</p>
            <p>Reason: {currentAlert.content}</p>
            <p>Strikes: {currentAlert.strikeCount}</p>
            <p>Received: {formatDate(currentAlert.timestamp)}</p>
            <button type="button" onClick={onDismissAlert}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
