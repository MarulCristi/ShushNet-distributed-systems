// Apartment interface
export interface Apartment {
  _id?: string;
  aptId: string;
  manager: string;
  createdAt?: Date;
}

// Complaint interface
export interface Complaint {
  _id?: string;
  apartmentId: string;
  content: string;
  timestamp: Date;
  senderIp?: string;
}

// Strike interface
export interface Strike {
  _id?: string;
  apartmentId: string;
  count: number;
  lastStrikeTime: Date;
  expiresAt: Date; // TTL index for nightly reset
}
