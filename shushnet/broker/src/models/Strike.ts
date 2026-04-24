import mongoose, { Schema, Document } from 'mongoose';

export interface IStrike extends Document {
  tenantId: string;
  apartmentId: string;
  count: number;
  lastStrikeTime: Date;
  expiresAt: Date; // TTL index
}

const strikeSchema = new Schema<IStrike>(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    apartmentId: {
      type: String,
      required: true,
      index: true,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastStrikeTime: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: () => {
        // Reset at next midnight
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow;
      },
      index: { expireAfterSeconds: 0 }, // TTL index - auto-delete at expiresAt time
    },
  },
  { timestamps: true }
);

export const Strike = mongoose.model<IStrike>('Strike', strikeSchema);
