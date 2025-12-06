import { Schema, model, models, type InferSchemaType } from "mongoose";

const FriendSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    friendId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    roomId: { type: Schema.Types.ObjectId, ref: "ChatRoom", required: true },
  },
  { timestamps: true }
);

FriendSchema.index({ userId: 1, friendId: 1 }, { unique: true });

export type FriendDocument = InferSchemaType<typeof FriendSchema>;
export const Friend = models.Friend || model("Friend", FriendSchema);
