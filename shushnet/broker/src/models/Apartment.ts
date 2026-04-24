import mongoose, { Schema, Document } from 'mongoose';

export interface IApartment extends Document {
  apartmentId: string;
  managerName: string;
  tenantName: string;
  tenantId: string;
  createdAt: Date;
}

const apartmentSchema = new Schema<IApartment>(
  {
    apartmentId: {
      type: String,
      required: true,
      index: true,
    },
    managerName: {
      type: String,
      required: true,
    },
    tenantName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    tenantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export const Apartment = mongoose.model<IApartment>('Apartment', apartmentSchema);
