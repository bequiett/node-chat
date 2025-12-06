"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  name?: string | null;
  image?: string | null;
};

export function ProfileMenu({ name, image }: Props) {
  const initial = name?.[0]?.toUpperCase() ?? "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-10 items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-3 shadow-sm shadow-orange-100 transition hover:-translate-y-0.5 hover:shadow-md">
          <Avatar className="h-7 w-7">
            <AvatarImage src={image ?? undefined} alt={name ?? "사용자"} />
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-semibold text-slate-800">{name ?? "사용자"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{name ?? "사용자"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/chat">프로필 설정</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-rose-600 focus:text-rose-600"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
