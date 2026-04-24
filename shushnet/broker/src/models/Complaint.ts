import mongoose, { Schema, Document } from 'mongoose';

export interface IComplaint extends Document {
  tenantId: string;
  apartmentId: string;
  content: string;
  timestamp: Date;
}

const complaintSchema = new Schema<IComplaint>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    apartmentId: {
      type: String,
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

export const Complaint = mongoose.model<IComplaint>('Complaint', complaintSchema);
