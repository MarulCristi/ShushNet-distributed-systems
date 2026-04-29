import mongoose, { Schema, Document } from 'mongoose';

export interface IApartment extends Document {
  apartmentId: number;
  managerName: string;
  tenantId: string;
  residentName?: string;
  createdAt: Date;
}

const apartmentSchema = new Schema<IApartment>(
  {
    apartmentId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    managerName: {
      type: String,
      required: true,
    },
    tenantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    residentName: {
      type: String,
      required: false,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export const Apartment = mongoose.model<IApartment>('Apartment', apartmentSchema);
