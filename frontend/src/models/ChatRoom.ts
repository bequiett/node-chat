import { Schema, model, models, type InferSchemaType } from "mongoose";

const ChatRoomSchema = new Schema(
  {
    type: { type: String, enum: ["direct", "group"], required: true },
    title: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: "User" },
    lastMessageMeta: {
      messageId: String,
      sentAt: Date,
      senderId: { type: Schema.Types.ObjectId, ref: "User" },
      previewText: String,
    },
  },
  { timestamps: true }
);

export type ChatRoomDocument = InferSchemaType<typeof ChatRoomSchema>;
export const ChatRoom = models.ChatRoom || model("ChatRoom", ChatRoomSchema);
