"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";

export interface Friend {
  id: string;
  name: string;
  avatar?: string;
  status: "online" | "offline" | "away";
  bio?: string;
  roomId?: string; // direct chat room id, if available
}

interface FriendListProps {
  friends: Friend[];
  onDeleteFriend: (id: string) => void;
  onAddFriend: (friendId: string) => void;
  onStartChat: (friend: Friend) => void;
}

const statusStyles: Record<Friend["status"], string> = {
  online: "bg-green-500",
  away: "bg-yellow-500",
  offline: "bg-gray-400",
};

const statusLabel: Record<Friend["status"], string> = {
  online: "온라인",
  away: "자리비움",
  offline: "오프라인",
};

export function FriendList({ friends, onAddFriend, onDeleteFriend, onStartChat }: FriendListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newFriendId, setNewFriendId] = useState("");

  const handleAddFriend = () => {
    if (!newFriendId.trim()) return;
    onAddFriend(newFriendId.trim());
    setNewFriendId("");
    setIsAdding(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-4">
        <div>
          <h2 className="text-lg font-semibold">친구</h2>
          <p className="text-sm text-muted-foreground">{friends.length}명</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="친구 추가"
          onClick={() => setIsAdding((value) => !value)}
        >
          {isAdding ? "–" : "+"}
        </Button>
      </div>

      {isAdding ? (
        <div className="space-y-3 border-b p-4">
          <label className="block text-sm font-medium" htmlFor="friend-name">
            친구 ID로 추가
          </label>
          <Input
            id="friend-name"
            value={newFriendId}
            onChange={(event) => setNewFriendId(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && handleAddFriend()}
            placeholder="친구 ID를 입력하세요"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsAdding(false)}>
              취소
            </Button>
            <Button onClick={handleAddFriend}>추가</Button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-2 p-4">
          {friends.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              친구가 없습니다. 추가 버튼을 눌러 새로운 친구를 만들어보세요.
            </div>
          ) : (
            friends.map((friend) => (
              <div key={friend.id} className="rounded-lg p-3 transition-colors hover:bg-accent">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={friend.avatar} alt={friend.name} />
                      <AvatarFallback>{friend.name?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
                    </Avatar>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                        statusStyles[friend.status],
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex-1 truncate font-medium">{friend.name}</span>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`${friend.name}과 대화`}
                          onClick={() => onStartChat(friend)}
                        >
                          💬
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`${friend.name} 삭제`}
                          onClick={() => onDeleteFriend(friend.id)}
                        >
                          ✕
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{statusLabel[friend.status]}</p>
                    {friend.bio ? (
                      <p className="mt-1 truncate text-sm text-muted-foreground">{friend.bio}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
