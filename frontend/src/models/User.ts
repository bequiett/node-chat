import { Schema, model, models, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    oauthProvider: { type: String, required: true },
    oauthId: { type: String, required: true, index: true },
    email: { type: String, required: true, index: true },
    displayName: { type: String, required: true },
    avatarUrl: { type: String },
    friendId: { type: String, unique: true, sparse: true },
    statusMessage: { type: String },
    publicKey: { type: String },
    blockedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

export type UserDocument = InferSchemaType<typeof UserSchema>;
export const User = models.User || model("User", UserSchema);
