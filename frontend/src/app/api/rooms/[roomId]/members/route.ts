import { NextRequest, NextResponse } from "next/server";
import mongoose, { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import { connectMongo } from "@/lib/mongoose";
import { ChatRoom } from "@/models/ChatRoom";
import { RoomMember } from "@/models/RoomMember";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const session = await requireAuth();
  if ("response" in session) return session.response;

  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    return NextResponse.json({ error: "Invalid roomId" }, { status: 400 });
  }

  await connectMongo();

  const membership = await RoomMember.findOne({
    roomId,
    userId: session.userId,
  })
    .select("_id role")
    .lean<{ _id: Types.ObjectId; role: string } | null>();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roomExists = await ChatRoom.exists({ _id: roomId });
  if (!roomExists) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const members = await RoomMember.find({ roomId })
    .select("userId role joinedAt lastReadAt mute")
    .lean<
      {
        _id: Types.ObjectId;
        userId: Types.ObjectId;
        role: string;
        joinedAt: Date;
        lastReadAt?: Date | null;
        mute?: boolean;
      }[]
    >();

  return NextResponse.json({
    members: members.map((m) => ({
      id: m._id.toString(),
      userId: m.userId.toString(),
      role: m.role,
      joinedAt: m.joinedAt,
      lastReadAt: m.lastReadAt,
      mute: m.mute,
    })),
  });
}
