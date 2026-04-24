// Manager Registration Payload
export interface RegisterTenantPayload {
  apartmentId: string;
  managerName: string;
  tenantName: string;
}

// Tenant Login Payload
export interface TenantLoginPayload {
  tenantName: string;
}

// Complaint Payload
export interface ComplaintPayload {
  tenantId: string;
  content: string;
}

export const validateRegisterTenant = (data: any): data is RegisterTenantPayload => {
  return (
    typeof data.apartmentId === 'string' &&
    data.apartmentId.trim().length > 0 &&
    typeof data.managerName === 'string' &&
    data.managerName.trim().length > 0 &&
    typeof data.tenantName === 'string' &&
    data.tenantName.trim().length > 0
  );
};

export const validateTenantLogin = (data: any): data is TenantLoginPayload => {
  return (
    typeof data.tenantName === 'string' &&
    data.tenantName.trim().length > 0
  );
};

export const validateComplaint = (data: any): data is ComplaintPayload => {
  return (
    typeof data.tenantId === 'string' &&
    data.tenantId.trim().length > 0 &&
    typeof data.content === 'string' &&
    data.content.trim().length > 0
  );
};
