import { NextResponse, type NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import { connectMongo } from "@/lib/mongoose";
import { ChatRoom } from "@/models/ChatRoom";
import { RoomMember } from "@/models/RoomMember";
import { Friend } from "@/models/Friend";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, context: any) {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  const roomId = context?.params?.roomId as string | undefined;
  if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
    return NextResponse.json({ error: "Invalid roomId" }, { status: 400 });
  }

  await connectMongo();

  const membership = await RoomMember.findOne({
    roomId,
    userId: session.userId,
  })
    .select("_id")
    .lean();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this room" }, { status: 404 });
  }

  const room = await ChatRoom.findById(roomId).select("_id type").lean<{ _id: any; type: "direct" | "group" }>();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  let otherMemberId: string | null = null;
  if (room.type === "direct") {
    const other = await RoomMember.findOne({ roomId, userId: { $ne: session.userId } })
      .select("userId")
      .lean<{ userId: mongoose.Types.ObjectId } | null>();
    if (other?.userId) {
      otherMemberId = other.userId.toString();
    }
  }

  await RoomMember.deleteOne({ roomId, userId: session.userId });

  if (room.type === "direct" && otherMemberId) {
    await Friend.updateOne(
      { userId: session.userId, friendId: otherMemberId },
      { $unset: { roomId: "" } },
    );
  }

  const remainingCount = await RoomMember.countDocuments({ roomId });
  if (remainingCount === 0) {
    await ChatRoom.deleteOne({ _id: roomId });
  }

  return NextResponse.json({
    ok: true,
    roomId,
    remainingMembers: remainingCount,
  });
}
