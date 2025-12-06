"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface ChatSummary {
  id: string;
  name: string;
  avatar?: string;
  lastMessage: string;
  timestamp: string;
  unread?: number;
  type?: "direct" | "group";
}

interface ChatListProps {
  chats: ChatSummary[];
  selectedChatId: string | null;
  onSelectChat: (id: string) => void;
}

export function ChatList({ chats, selectedChatId, onSelectChat }: ChatListProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2 p-4">
        {chats.map((chat) => (
          <Button
            key={chat.id}
            variant="ghost"
            className={cn(
              "h-auto w-full justify-start rounded-lg p-3 text-left",
              selectedChatId === chat.id && "bg-accent",
            )}
            onClick={() => onSelectChat(chat.id)}
          >
            <div className="flex items-start gap-3">
              <Avatar>
                <AvatarImage src={chat.avatar} alt={chat.name} />
                <AvatarFallback>{chat.name?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex-1 truncate font-medium">{chat.name}</span>
                  {chat.timestamp ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{chat.timestamp}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <p className="flex-1 truncate text-sm text-muted-foreground">{chat.lastMessage}</p>
                  {chat.unread ? (
                    <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-center text-xs text-primary-foreground">
                      {chat.unread}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}
