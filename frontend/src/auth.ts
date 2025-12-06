import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { connectMongo } from "@/lib/mongoose";
import { User } from "@/models/User";

const getEnv = (primary: string, fallback?: string) => {
  const value = process.env[primary] || (fallback ? process.env[fallback] : "");
  if (!value) throw new Error(`Missing environment variable: ${primary}`);
  return value;
};

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  session: { strategy: "jwt" },
  secret: getEnv("AUTH_SECRET", "NEXTAUTH_SECRET"),
  providers: [
    GoogleProvider({
      clientId: getEnv("AUTH_GOOGLE_ID", "GOOGLE_CLIENT_ID"),
      clientSecret: getEnv("AUTH_GOOGLE_SECRET", "GOOGLE_CLIENT_SECRET"),
    }),
    GitHubProvider({
      clientId: getEnv("AUTH_GITHUB_ID", "GITHUB_CLIENT_ID"),
      clientSecret: getEnv("AUTH_GITHUB_SECRET", "GITHUB_CLIENT_SECRET"),
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || !user.email) return false;
      await connectMongo();

      const displayName =
        user.name ||
        (profile && typeof profile === "object" && "name" in profile
          ? String((profile as Record<string, unknown>).name)
          : undefined) ||
        user.email.split("@")[0];

      const dbUser = await User.findOneAndUpdate(
        {
          oauthProvider: account.provider,
          oauthId: account.providerAccountId,
        },
        {
          oauthProvider: account.provider,
          oauthId: account.providerAccountId,
          email: user.email,
          displayName,
          avatarUrl: user.image,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      (user as any).id = dbUser._id.toString();
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userId = (user as any).id ?? token.sub;
        token.name = user.name ?? token.name;
        token.email = user.email ?? token.email;
        token.picture = (user as any).image ?? token.picture;
      }
      return token;
  },
  async session({ session, token }) {
    if (session.user) {
      const userId = ((token as any).userId as string | undefined) ?? token.sub ?? "";
      session.user.id = userId;
      session.user.name = token.name ?? session.user.name ?? "";
      session.user.email = token.email ?? session.user.email ?? "";
      session.user.image = ((token as any).picture as string | undefined) ?? undefined;
    }
    return session;
  },
  },
  pages: {
    signIn: "/auth/login",
  },
});
