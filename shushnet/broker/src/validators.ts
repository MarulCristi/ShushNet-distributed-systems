// Manager Registration Payload
export interface RegisterApartmentPayload {
  apartmentId: number;
  managerName: string;
  residentName?: string;
}

// Tenant Login Payload
export interface TenantLoginPayload {
  apartmentId: number;
}

// Complaint Payload
export interface ComplaintPayload {
  apartmentId: number;
  content: string;
}

const parseApartmentId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
};

export const validateRegisterApartment = (data: any): data is RegisterApartmentPayload => {
  const apartmentId = parseApartmentId(data.apartmentId);
  const residentNameIsValid =
    data.residentName === undefined ||
    (typeof data.residentName === 'string' && data.residentName.trim().length > 0);

  return (
    apartmentId !== null &&
    typeof data.managerName === 'string' &&
    data.managerName.trim().length > 0 &&
    residentNameIsValid
  );
};

export const validateTenantLogin = (data: any): data is TenantLoginPayload => {
  return parseApartmentId(data.apartmentId) !== null;
};

export const validateComplaint = (data: any): data is ComplaintPayload => {
  const apartmentId = parseApartmentId(data.apartmentId);

  return (
    apartmentId !== null &&
    typeof data.content === 'string' &&
    data.content.trim().length > 0
  );
};
