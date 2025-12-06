import { NextRequest, NextResponse } from "next/server";
import mongoose, { type Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import { connectMongo } from "@/lib/mongoose";
import { ChatRoom } from "@/models/ChatRoom";
import { RoomMember } from "@/models/RoomMember";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  await connectMongo();

  const memberships = await RoomMember.find({ userId: session.userId })
    .select("roomId role")
    .lean<{ roomId: Types.ObjectId; role: "owner" | "admin" | "member" }[]>();
  const roomIds = memberships.map((m) => m.roomId);

  const rooms = await ChatRoom.find({ _id: { $in: roomIds } })
    .select("_id type title ownerId lastMessageMeta createdAt updatedAt")
    .lean<{
      _id: Types.ObjectId;
      type: "direct" | "group";
      title?: string;
      ownerId?: Types.ObjectId | null;
      lastMessageMeta?: {
        messageId?: string;
        sentAt?: Date;
        senderId?: Types.ObjectId;
        previewText?: string;
      };
      createdAt?: Date;
      updatedAt?: Date;
    }[]>();

  const memberRoles = new Map(
    memberships.map((m) => [m.roomId.toString(), m.role])
  );

  const directIds = rooms
    .filter((r) => r.type === "direct")
    .map((r) => r._id);

  const peers = await RoomMember.find({
    roomId: { $in: directIds },
    userId: { $ne: session.userId },
  })
    .select("roomId userId")
    .populate("userId", "displayName avatarUrl friendId")
    .lean<{
      roomId: Types.ObjectId;
      userId: { _id: Types.ObjectId; displayName: string; avatarUrl?: string; friendId?: string };
    }[]>();

  const peerByRoom = new Map(
    peers.map((p) => [
      p.roomId.toString(),
      {
        id: p.userId._id.toString(),
        displayName: p.userId.displayName,
        avatarUrl: p.userId.avatarUrl,
        friendId: p.userId.friendId,
      },
    ])
  );

  return NextResponse.json({
    rooms: rooms.map((r) => ({
      id: r._id.toString(),
      type: r.type,
      title: r.title,
      ownerId: r.ownerId?.toString(),
      lastMessageMeta: r.lastMessageMeta,
      role: memberRoles.get(r._id.toString()),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      peer: peerByRoom.get(r._id.toString()),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  const body = await req.json().catch(() => null);
  const { type, title, participantIds } = body ?? {};

  if (!["direct", "group"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const participants: string[] = Array.isArray(participantIds)
    ? participantIds.filter((id) => typeof id === "string")
    : [];

  if (type === "direct") {
    if (participants.length !== 1) {
      return NextResponse.json({ error: "Direct chat requires one other user" }, { status: 400 });
    }
    const otherId = participants[0];
    if (!mongoose.Types.ObjectId.isValid(otherId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }
    if (otherId === session.userId) {
      return NextResponse.json({ error: "Cannot create direct chat with yourself" }, { status: 400 });
    }

    await connectMongo();

    // Try to find an existing direct room between the two users.
    const memberships = await RoomMember.find({
      userId: { $in: [session.userId, otherId] },
    })
      .select("roomId userId")
    .lean<{ roomId: Types.ObjectId; userId: Types.ObjectId }[]>();

    const roomCount: Record<string, number> = {};
    memberships.forEach((m) => {
      const key = m.roomId.toString();
      roomCount[key] = (roomCount[key] || 0) + 1;
    });
    const sharedRoomIds = Object.entries(roomCount)
      .filter(([, count]) => count === 2)
      .map(([roomId]) => roomId);

    if (sharedRoomIds.length) {
      const existing = await ChatRoom.findOne({
        _id: { $in: sharedRoomIds },
        type: "direct",
      }).lean<{ _id: Types.ObjectId; type: "direct"; title?: string | null } | null>();
      if (existing) {
        return NextResponse.json({
          room: { id: existing._id.toString(), type: existing.type, title: existing.title },
          reused: true,
        });
      }
    }

    const room = await ChatRoom.create({
      type: "direct",
    });
    await RoomMember.insertMany([
      { roomId: room._id, userId: session.userId, role: "member" },
      { roomId: room._id, userId: otherId, role: "member" },
    ]);

    return NextResponse.json({
      room: { id: room._id.toString(), type: room.type, title: room.title },
      reused: false,
    });
  }

  // group
  const uniqueParticipants = Array.from(
    new Set(participants.filter((id) => mongoose.Types.ObjectId.isValid(id)))
  ).filter((id) => id !== session.userId);

  if (uniqueParticipants.length < 2) {
    return NextResponse.json(
      { error: "Group chat requires at least two other users (3 total)" },
      { status: 400 }
    );
  }

  await connectMongo();

  const room = await ChatRoom.create({
    type: "group",
    title: title || "New group",
    ownerId: session.userId,
  });

  const members = [
    { roomId: room._id, userId: session.userId, role: "owner" },
    ...uniqueParticipants.map((uid) => ({
      roomId: room._id,
      userId: uid,
      role: "member",
    })),
  ];
  await RoomMember.insertMany(members);

  return NextResponse.json({
    room: { id: room._id.toString(), type: room.type, title: room.title },
    reused: false,
  });
}
