import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import type { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import { connectMongo } from "@/lib/mongoose";
import { FriendRequest } from "@/models/FriendRequest";
import { User } from "@/models/User";
import { ChatRoom } from "@/models/ChatRoom";
import { RoomMember } from "@/models/RoomMember";
import { Friend } from "@/models/Friend";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  const body = await req.json().catch(() => null);
  const toUserId = body?.toUserId as string | undefined;
  const friendId = (body?.friendId as string | undefined)?.trim().toLowerCase();

  await connectMongo();

  let targetUserId = toUserId;

  if (friendId) {
    const targetByFriendId = await User.findOne({ friendId }).select("_id").lean<{ _id: Types.ObjectId }>();
    if (!targetByFriendId) {
      return NextResponse.json({ error: "해당 친구 ID를 가진 사용자가 없습니다." }, { status: 404 });
    }
    targetUserId = targetByFriendId._id.toString();
  }

  if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
    return NextResponse.json({ error: "Invalid toUserId" }, { status: 400 });
  }
  if (targetUserId === session.userId) {
    return NextResponse.json({ error: "Cannot send request to yourself" }, { status: 400 });
  }

  const target = await User.findById(targetUserId).select("_id");
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (await isBlockedEitherDirection(session.userId, targetUserId)) {
    return NextResponse.json({ error: "사용자와의 소통이 차단되었습니다." }, { status: 403 });
  }

  const request = await FriendRequest.findOneAndUpdate(
    { fromUserId: session.userId, toUserId: targetUserId, status: { $ne: "blocked" } },
    { status: "pending" },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean<{
    _id: Types.ObjectId;
    fromUserId: Types.ObjectId;
    toUserId: Types.ObjectId;
    status: string;
  }>();

  if (!request) {
    return NextResponse.json(
      { error: "Failed to create friend request" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    request: {
      id: request._id.toString(),
      fromUserId: request.fromUserId.toString(),
      toUserId: request.toUserId.toString(),
      status: request.status,
    },
  });
}

type FriendAction = "accept" | "reject" | "block" | "cancel";

export async function GET() {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  await connectMongo();

  const incoming = await FriendRequest.find({ toUserId: session.userId, status: "pending" })
    .select("_id fromUserId status createdAt")
    .populate("fromUserId", "displayName avatarUrl")
    .lean<{
      _id: Types.ObjectId;
      fromUserId: { _id: Types.ObjectId; displayName: string; avatarUrl?: string };
      status: string;
      createdAt: Date;
    }[]>();

  const outgoing = await FriendRequest.find({ fromUserId: session.userId, status: "pending" })
    .select("_id toUserId status createdAt")
    .populate("toUserId", "displayName avatarUrl")
    .lean<{
      _id: Types.ObjectId;
      toUserId: { _id: Types.ObjectId; displayName: string; avatarUrl?: string };
      status: string;
      createdAt: Date;
    }[]>();

  return NextResponse.json({
    incoming: incoming.map((req) => ({
      id: req._id.toString(),
      fromUser: {
        id: req.fromUserId._id.toString(),
        displayName: req.fromUserId.displayName,
        avatarUrl: req.fromUserId.avatarUrl,
      },
      status: req.status,
      createdAt: req.createdAt,
    })),
    outgoing: outgoing.map((req) => ({
      id: req._id.toString(),
      toUser: {
        id: req.toUserId._id.toString(),
        displayName: req.toUserId.displayName,
        avatarUrl: req.toUserId.avatarUrl,
      },
      status: req.status,
      createdAt: req.createdAt,
    })),
    friends: await fetchFriendsList(session.userId),
  });
}

export async function PATCH(req: NextRequest) {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  const body = await req.json().catch(() => null);
  const { requestId, action } = body ?? {};
  if (!requestId || !mongoose.Types.ObjectId.isValid(requestId)) {
    return NextResponse.json({ error: "Invalid requestId" }, { status: 400 });
  }
  if (!["accept", "reject", "block", "cancel"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  await connectMongo();

  const fr = await FriendRequest.findById(requestId);
  if (!fr) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isSender = fr.fromUserId.toString() === session.userId;
  const isRecipient = fr.toUserId.toString() === session.userId;

  if (action === "cancel") {
    if (!isSender) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await fr.deleteOne();
    return NextResponse.json({ ok: true, deleted: true });
  }

  if (!isRecipient && action !== "block") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (action === "accept") fr.status = "accepted";
  if (action === "reject") fr.status = "rejected";
  if (action === "block") {
    // block allowed by either sender or recipient
    fr.status = "blocked";
    if (!isSender && !isRecipient) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await applyBlock(fr.fromUserId.toString(), fr.toUserId.toString());
  }

  if (action === "accept") fr.status = "accepted";

  await fr.save();

  if (action === "accept") {
    const { roomId, reused } = await ensureDirectRoom(
      fr.fromUserId.toString(),
      fr.toUserId.toString()
    );
    await ensureFriendship(
      fr.fromUserId.toString(),
      fr.toUserId.toString(),
      roomId
    );
    return NextResponse.json({
      request: {
        id: fr._id.toString(),
        fromUserId: fr.fromUserId.toString(),
        toUserId: fr.toUserId.toString(),
        status: fr.status,
      },
      directRoomId: roomId,
      reused,
    });
  }

  if (action === "reject" || action === "block") {
    await removeFriendship(fr.fromUserId.toString(), fr.toUserId.toString());
  }

  return NextResponse.json({
    request: {
      id: fr._id.toString(),
      fromUserId: fr.fromUserId.toString(),
      toUserId: fr.toUserId.toString(),
      status: fr.status,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  const body = await req.json().catch(() => null);
  const friendId = (body?.friendId as string | undefined)?.trim().toLowerCase();
  const toUserId = body?.toUserId as string | undefined;

  await connectMongo();

  let targetUserId = toUserId;
  if (friendId) {
    const targetByFriendId = await User.findOne({ friendId }).select("_id").lean<{ _id: Types.ObjectId }>();
    if (!targetByFriendId) {
      return NextResponse.json({ error: "해당 친구 ID를 가진 사용자가 없습니다." }, { status: 404 });
    }
    targetUserId = targetByFriendId._id.toString();
  }

  if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
    return NextResponse.json({ error: "Invalid toUserId" }, { status: 400 });
  }
  if (targetUserId === session.userId) {
    return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
  }

  const friendship = await Friend.findOne({
    userId: session.userId,
    friendId: targetUserId,
  })
    .select("roomId")
    .lean<{ roomId: Types.ObjectId } | null>();

  if (!friendship) {
    return NextResponse.json({ error: "Friendship not found" }, { status: 404 });
  }

  await removeFriendship(session.userId, targetUserId);

  return NextResponse.json({
    ok: true,
    roomId: friendship.roomId.toString(),
    friends: await fetchFriendsList(session.userId),
  });
}

async function ensureDirectRoom(userA: string, userB: string) {
  const memberships = await RoomMember.find({
    userId: { $in: [userA, userB] },
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
    }).lean<{ _id: Types.ObjectId } | null>();
    if (existing) {
      return { roomId: existing._id.toString(), reused: true };
    }
  }

  const room = await ChatRoom.create({ type: "direct" });
  await RoomMember.insertMany([
    { roomId: room._id, userId: userA, role: "member" },
    { roomId: room._id, userId: userB, role: "member" },
  ]);

  return { roomId: room._id.toString(), reused: false };
}

async function ensureFriendship(userA: string, userB: string, roomId: string) {
  const aId = new mongoose.Types.ObjectId(userA);
  const bId = new mongoose.Types.ObjectId(userB);
  const roomObjectId = new mongoose.Types.ObjectId(roomId);

  await Friend.bulkWrite([
    {
      updateOne: {
        filter: { userId: aId, friendId: bId },
        update: {
          $set: {
            userId: aId,
            friendId: bId,
            roomId: roomObjectId,
          },
        },
        upsert: true,
      },
    },
    {
      updateOne: {
        filter: { userId: bId, friendId: aId },
        update: {
          $set: {
            userId: bId,
            friendId: aId,
            roomId: roomObjectId,
          },
        },
        upsert: true,
      },
    },
  ]);
}

async function removeFriendship(userA: string, userB: string) {
  const aId = new mongoose.Types.ObjectId(userA);
  const bId = new mongoose.Types.ObjectId(userB);

  await Friend.deleteMany({
    $or: [
      { userId: aId, friendId: bId },
      { userId: bId, friendId: aId },
    ],
  });

  const sharedRooms = await RoomMember.aggregate<{ roomId: Types.ObjectId }>([
    { $match: { userId: { $in: [aId, bId] } } },
    { $group: { _id: "$roomId", members: { $addToSet: "$userId" }, count: { $sum: 1 } } },
    { $match: { count: { $gte: 2 }, members: { $all: [aId, bId] } } },
    { $project: { roomId: "$_id" } },
  ]);
  const sharedRoomIds = sharedRooms.map((r) => r.roomId);
  if (sharedRoomIds.length) {
    await RoomMember.deleteMany({
      roomId: { $in: sharedRoomIds },
      userId: { $in: [aId, bId] },
    });
  }
}

async function applyBlock(userA: string, userB: string) {
  const aId = new mongoose.Types.ObjectId(userA);
  const bId = new mongoose.Types.ObjectId(userB);
  await Promise.all([
    removeFriendship(userA, userB),
    User.findByIdAndUpdate(aId, { $addToSet: { blockedUserIds: bId } }),
    User.findByIdAndUpdate(bId, { $addToSet: { blockedUserIds: aId } }),
  ]);
}

async function isBlockedEitherDirection(userA: string, userB: string) {
  const aId = new mongoose.Types.ObjectId(userA);
  const bId = new mongoose.Types.ObjectId(userB);
  const blockedRequest = await FriendRequest.findOne({
    $or: [
      { fromUserId: aId, toUserId: bId, status: "blocked" },
      { fromUserId: bId, toUserId: aId, status: "blocked" },
    ],
  })
    .select("_id")
    .lean();
  if (blockedRequest) return true;

  const blockedUser = await User.exists({
    _id: aId,
    blockedUserIds: bId,
  });
  const blockedUserReverse = await User.exists({
    _id: bId,
    blockedUserIds: aId,
  });
  return Boolean(blockedUser || blockedUserReverse);
}

async function fetchFriendsList(userId: string) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return [];
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const friendships = await Friend.find({ userId: userObjectId })
    .select("friendId roomId")
    .populate("friendId", "displayName avatarUrl friendId")
    .lean<
      {
        roomId: Types.ObjectId;
        friendId: {
          _id: Types.ObjectId;
          displayName: string;
          avatarUrl?: string;
          friendId?: string;
        };
      }[]
    >();

  return friendships.map((entry) => ({
    id: entry.friendId._id.toString(),
    displayName: entry.friendId.displayName,
    avatarUrl: entry.friendId.avatarUrl,
    friendId: entry.friendId.friendId,
    roomId: entry.roomId.toString(),
  }));
}
