import { Schema, model, models, type InferSchemaType } from "mongoose";

const TempMessageSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, ref: "ChatRoom", index: true },
    messageId: { type: String, required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    recipientIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    encryptedPayload: { type: String, required: true },
    sentAt: { type: Date, required: true },
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

TempMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 5 });

export type TemporaryMessageBufferDocument = InferSchemaType<
  typeof TempMessageSchema
>;
export const TemporaryMessageBuffer =
  models.TemporaryMessageBuffer ||
  model("TemporaryMessageBuffer", TempMessageSchema);
