import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import './App.css';

type Role = 'manager' | 'tenant';

interface ApartmentStrikeSummary {
  apartmentId: number;
  residentName: string | null;
  strikeCount: number;
  complaints: Array<{ content: string; timestamp: string }>;
}

interface ComplaintsResponseItem {
  apartmentId: number;
  residentName: string | null;
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
  const centerX = 450;
  const centerY = 235;
  const radius = 220;
  const managerY = 60;

  const nodes = useMemo(() => {
    if (apartments.length === 0) {
      return [] as Array<ApartmentStrikeSummary & { x: number; y: number }>;
    }

    return apartments.map((apartment, index) => {
      const angle = (Math.PI * 2 * index) / apartments.length - Math.PI / 2;
      return {
        ...apartment,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });
  }, [apartments]);

  return (
    <section className="panel graph-panel">
      <header className="panel-header">
        <h2>Network Graph</h2>
        <p>Click an apartment node to inspect details or target complaints.</p>
      </header>
      <svg className="network-graph" viewBox="0 0 900 500" role="img" aria-label="Building graph">
        <defs>
          <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {nodes.map((node) => (
          <line
            key={`edge-${node.apartmentId}`}
            x1={centerX}
            y1={managerY + 24}
            x2={node.x}
            y2={node.y - 24}
            className="graph-edge"
          />
        ))}

        <g className="graph-manager" transform={`translate(${centerX}, ${managerY})`}>
          <circle r="34" className="manager-node" />
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
              onClick={() => onSelectApartment(node.apartmentId)}
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
      </svg>
    </section>
  );
};

function App() {
  const [role, setRole] = useState<Role | null>(null);
  const [managerName, setManagerName] = useState('');
  const [registerApartmentNumber, setRegisterApartmentNumber] = useState('');
  const [registerResidentName, setRegisterResidentName] = useState('');

  const [tenantApartmentNumber, setTenantApartmentNumber] = useState('');
  const [tenantSession, setTenantSession] = useState<TenantSession | null>(null);
  const tenantSocketRef = useRef<Socket | null>(null);

  const [apartments, setApartments] = useState<ApartmentStrikeSummary[]>([]);
  const [complaintsList, setComplaintsList] = useState<ComplaintsResponseItem[]>([]);
  const [selectedApartment, setSelectedApartment] = useState<number | null>(null);
  const [complaintTargetNumber, setComplaintTargetNumber] = useState('');
  const [complaintMessage, setComplaintMessage] = useState('');
  const [alerts, setAlerts] = useState<ComplaintAlertPayload[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentAlert = alerts[0] || null;

  const refreshApartmentGraph = async () => {
    const response = await api.get<{ apartments: ApartmentStrikeSummary[] }>('/strikes');
    const apartmentData = response.data.apartments || [];
    setApartments(apartmentData);

    if (apartmentData.length > 0 && selectedApartment === null) {
      setSelectedApartment(apartmentData[0].apartmentId);
    }

    if (selectedApartment !== null && !apartmentData.some((item) => item.apartmentId === selectedApartment)) {
      setSelectedApartment(apartmentData.length > 0 ? apartmentData[0].apartmentId : null);
    }
  };

  const fetchComplaints = async (apartmentFilter?: number) => {
    const params = apartmentFilter ? { apartmentId: apartmentFilter } : undefined;
    const response = await api.get<{ complaints: ComplaintsResponseItem[] }>('/complaints', { params });
    setComplaintsList(response.data.complaints || []);
  };

  useEffect(() => {
    void refreshApartmentGraph();
    void fetchComplaints();
  }, []);

  useEffect(() => {
    return () => {
      tenantSocketRef.current?.disconnect();
    };
  }, []);

  const resetMessages = () => {
    setFeedback(null);
    setError(null);
  };

  const handleRegisterApartment = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();

    const apartmentNumber = parseApartmentNumber(registerApartmentNumber);
    if (apartmentNumber === null) {
      setError('Apartment number must be a positive integer.');
      return;
    }

    if (!managerName.trim() || !registerResidentName.trim()) {
      setError('Manager name and resident name are required.');
      return;
    }

    try {
      await api.post('/manager/register-apartment', {
        apartmentId: apartmentNumber,
        managerName: managerName.trim(),
        residentName: registerResidentName.trim(),
      });
      setFeedback(`Apartment #${apartmentNumber} registered.`);
      setRegisterApartmentNumber('');
      setRegisterResidentName('');
      await refreshApartmentGraph();
      await fetchComplaints();
    } catch (requestError: any) {
      const message =
        requestError.response?.data?.error ||
        requestError.response?.data?.message ||
        requestError.message ||
        'Registration failed';
      setError(message);
    }
  };

  const handleTenantLogin = async (event: FormEvent) => {
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

      setTenantSession(session);
      setFeedback(`Logged in as apartment #${session.apartmentId}.`);
      setSelectedApartment(session.apartmentId);
      setComplaintTargetNumber('');

      tenantSocketRef.current?.disconnect();
      const socket = io(brokerUrl);
      tenantSocketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('join_room', session.tenantId);
      });

      socket.on('complaint_received', (alertData: ComplaintAlertPayload) => {
        setAlerts((previous) => [...previous, alertData]);
        void refreshApartmentGraph();
        void fetchComplaints();
      });
    } catch (requestError: any) {
      const message =
        requestError.response?.data?.error ||
        requestError.response?.data?.message ||
        requestError.message ||
        'Login failed';
      setError(message);
    }
  };

  const handleTenantLogout = () => {
    tenantSocketRef.current?.disconnect();
    tenantSocketRef.current = null;
    setTenantSession(null);
    setAlerts([]);
    setFeedback('Logged out.');
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

    try {
      await api.post('/complaint', {
        apartmentId: targetApartment,
        content: complaintMessage.trim(),
      });
      setFeedback(`Complaint filed against apartment #${targetApartment}.`);
      setComplaintMessage('');
      await refreshApartmentGraph();
      await fetchComplaints();
    } catch (requestError: any) {
      const message =
        requestError.response?.data?.error ||
        requestError.response?.data?.message ||
        requestError.message ||
        'Failed to file complaint';
      setError(message);
    }
  };

  const handleManagerComplaintFilter = async (filterApartment?: number) => {
    resetMessages();

    try {
      await fetchComplaints(filterApartment);
      if (filterApartment) {
        setFeedback(`Showing complaints for apartment #${filterApartment}.`);
      } else {
        setFeedback('Showing complaints for all apartments.');
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

  const selectedApartmentData =
    selectedApartment === null
      ? null
      : apartments.find((apartment) => apartment.apartmentId === selectedApartment) || null;

  const tenantOwnComplaints = useMemo(() => {
    if (!tenantSession) {
      return [] as ComplaintsResponseItem[];
    }

    return complaintsList.filter((item) => item.apartmentId === tenantSession.apartmentId);
  }, [complaintsList, tenantSession]);

  const onDismissAlert = () => {
    setAlerts((previous) => previous.slice(1));
  };

  return (
    <div className="app-shell">
      <div className="background-glow" />
      <header className="top-bar">
        <h1>ShushNet Control Deck</h1>
        <p>Broker-backed complaints network with manager and tenant web flows.</p>
      </header>

      <section className="role-switch panel">
        <div className="role-buttons">
          <button type="button" className={role === 'manager' ? 'active' : ''} onClick={() => setRole('manager')}>
            Building Manager
          </button>
          <button type="button" className={role === 'tenant' ? 'active' : ''} onClick={() => setRole('tenant')}>
            Apartment Tenant
          </button>
        </div>
      </section>

      {feedback && <div className="banner success">{feedback}</div>}
      {error && <div className="banner error">{error}</div>}

      {role === 'manager' && (
        <main className="layout-grid manager-layout">
          <GraphView
            apartments={apartments}
            selectedApartment={selectedApartment}
            onSelectApartment={(apartmentId) => {
              setSelectedApartment(apartmentId);
              void handleManagerComplaintFilter(apartmentId);
            }}
          />

          <section className="panel">
            <header className="panel-header">
              <h2>Manager Controls</h2>
              <p>Register apartment accounts and resident names in the broker DB.</p>
            </header>

            <form className="stack-form" onSubmit={handleRegisterApartment}>
              <label>
                Manager Name
                <input
                  value={managerName}
                  onChange={(event) => setManagerName(event.target.value)}
                  placeholder="e.g. Carla Ortega"
                />
              </label>
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
                </>
              ) : (
                <p>Select an apartment node.</p>
              )}
            </div>
          </section>

          <section className="panel complaints-panel">
            <header className="panel-header">
              <h2>Complaint List</h2>
              <p>`s` equivalent: all complaints or filtered by apartment.</p>
            </header>

            <div className="actions-row">
              <button type="button" onClick={() => void handleManagerComplaintFilter()}>
                Show All Complaints
              </button>
              <button
                type="button"
                disabled={selectedApartment === null}
                onClick={() => {
                  if (selectedApartment !== null) {
                    void handleManagerComplaintFilter(selectedApartment);
                  }
                }}
              >
                Show Selected Apartment
              </button>
            </div>

            <ul className="complaint-list">
              {complaintsList.map((complaint, index) => (
                <li key={`${complaint.apartmentId}-${complaint.timestamp}-${index}`}>
                  <div className="complaint-top">
                    <span>Apartment #{complaint.apartmentId}</span>
                    <time>{formatDate(complaint.timestamp)}</time>
                  </div>
                  <p className="resident-line">Resident: {complaint.residentName || 'Unknown'}</p>
                  <p>{complaint.content}</p>
                </li>
              ))}
              {complaintsList.length === 0 && <li className="empty">No complaints available.</li>}
            </ul>
          </section>
        </main>
      )}

      {role === 'tenant' && (
        <main className="layout-grid tenant-layout">
          <section className="panel">
            <header className="panel-header">
              <h2>Tenant Session</h2>
              <p>Login by apartment number, then file complaints directly from the graph.</p>
            </header>

            {!tenantSession ? (
              <form className="stack-form" onSubmit={handleTenantLogin}>
                <label>
                  Apartment Number
                  <input
                    value={tenantApartmentNumber}
                    onChange={(event) => setTenantApartmentNumber(event.target.value)}
                    placeholder="e.g. 302"
                  />
                </label>
                <button type="submit">Login</button>
              </form>
            ) : (
              <div className="session-details">
                <p>Logged in as apartment #{tenantSession.apartmentId}</p>
                <p>Resident: {tenantSession.residentName || 'Not registered in manager profile'}</p>
                <button type="button" onClick={handleTenantLogout}>
                  Logout
                </button>
              </div>
            )}
          </section>

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
              <p>Choose an apartment node or type a number, then submit reason.</p>
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
              <h3>Your Complaints</h3>
              <ul className="complaint-list compact">
                {tenantOwnComplaints.map((complaint, index) => (
                  <li key={`${complaint.timestamp}-${index}`}>
                    <div className="complaint-top">
                      <span>Against apartment #{complaint.apartmentId}</span>
                      <time>{formatDate(complaint.timestamp)}</time>
                    </div>
                    <p>{complaint.content}</p>
                  </li>
                ))}
                {tenantOwnComplaints.length === 0 && <li className="empty">No complaints filed against your apartment yet.</li>}
              </ul>
            </div>
          </section>
        </main>
      )}

      {!role && (
        <section className="panel role-hint">
          <h2>Select a role to begin</h2>
          <p>Both flows are integrated in this web interface while the broker remains the backend authority.</p>
        </section>
      )}

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


