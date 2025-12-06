import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: session.user.id };
}
