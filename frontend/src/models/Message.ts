import { Schema, model, models, type InferSchemaType } from "mongoose";

const MessageSchema = new Schema(
  {
    messageId: { type: String, required: true, unique: true, index: true },
    roomId: { type: Schema.Types.ObjectId, ref: "ChatRoom", required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    content: { type: String, required: true },
    sentAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

export type MessageDocument = InferSchemaType<typeof MessageSchema>;
export const Message = models.Message || model("Message", MessageSchema);
