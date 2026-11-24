import { Schema, model, type Types } from "mongoose";

/**
 * One uploaded file, held in the store's own database. Documents go here rather
 * than a third-party host, so a PDF or a scan opens without another service
 * being up. The bytes sit beside the row; the cap in `file.types` keeps it small.
 */
const storedFileSchema = new Schema(
  {
    /** The name the applicant's file had, kept so a reviewer can recognise it. */
    name: { type: String, required: true, trim: true },
    mime: { type: String, required: true, trim: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    /** The account that sent it, for an audit trail. */
    uploadedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export interface StoredFile {
  _id: Types.ObjectId;
  name: string;
  mime: string;
  size: number;
  data: Buffer;
  uploadedBy?: string;
  createdAt?: Date;
}

export const StoredFileModel = model<StoredFile>("StoredFile", storedFileSchema);
