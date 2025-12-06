import { Schema, model, models, type InferSchemaType } from "mongoose";

const RoomMemberSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, ref: "ChatRoom", index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    role: { type: String, enum: ["owner", "admin", "member"], default: "member" },
    joinedAt: { type: Date, default: Date.now },
    lastReadAt: { type: Date },
    mute: { type: Boolean, default: false },
  },
  { timestamps: true }
);

RoomMemberSchema.index({ roomId: 1, userId: 1 }, { unique: true });

export type RoomMemberDocument = InferSchemaType<typeof RoomMemberSchema>;
export const RoomMember =
  models.RoomMember || model("RoomMember", RoomMemberSchema);
