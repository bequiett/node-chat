import { Schema, model, models, type InferSchemaType } from "mongoose";

const FriendRequestSchema = new Schema(
  {
    fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "blocked"],
      default: "pending",
    },
  },
  { timestamps: true }
);

FriendRequestSchema.index({ fromUserId: 1, toUserId: 1 }, { unique: true });

export type FriendRequestDocument = InferSchemaType<typeof FriendRequestSchema>;
export const FriendRequest =
  models.FriendRequest || model("FriendRequest", FriendRequestSchema);
