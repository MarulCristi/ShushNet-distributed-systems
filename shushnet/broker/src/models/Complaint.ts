import mongoose, { Schema, Document } from 'mongoose';

export interface IComplaint extends Document {
  apartmentId: number;
  authorApartmentId?: number;
  content: string;
  timestamp: Date;
}

const complaintSchema = new Schema<IComplaint>(
  {
    apartmentId: {
      type: Number,
      required: true,
      index: true,
    },
    authorApartmentId: {
      type: Number,
      required: false,
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
