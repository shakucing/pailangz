import { getServerSession, type NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { createHash } from "node:crypto";
import { db, securityEvent, rateLimit, ensureRuntime, type Actor } from "./db";
import { canAccess, DomainError } from "./domain";
import { headers } from "next/headers";
export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/staff" },
  providers: [
    Credentials({
      name: "Staff",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = (credentials?.email ?? "").trim().toLowerCase();
        const digest = createHash("sha256").update(email).digest("hex");
        try {
          await ensureRuntime();
          await rateLimit(`login:${digest}`, 5, 300);
          await rateLimit("login:deployment", 60, 60);
          const user = await db.staffUser.findUnique({ where: { email } });
          const passwordOk = await compare(
            credentials?.password ?? "",
            user?.passwordHash ??
              "$2b$12$BsUfJx0e2XwUk3jH2SN63eKAOQQYTRArOTWDWWXWyBOOjE9eqM1Ca",
          );
          if (!user || user.suspended || !passwordOk) throw new Error("denied");
          const session = await db.$transaction(async (tx) => {
            const current = await tx.staffUser.findUnique({
              where: { id: user.id },
            });
            if (
              !current ||
              current.suspended ||
              current.passwordHash !== user.passwordHash ||
              current.sessionVersion !== user.sessionVersion
            )
              throw new Error("denied");
            const s = await tx.staffSession.create({
              data: {
                userId: user.id,
                expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
              },
            });
            // Login has no staff context yet. Do not RETURNING private audit rows.
            await tx.auditEvent.createMany({
              data: {
                actorId: user.id,
                actorRole: "AUTH",
                action: "AUTH_LOGIN",
                entityType: "SECURITY",
                entityId: user.id,
                changes: { authenticationMethod: "password" },
                correlationId: crypto.randomUUID(),
                source: "AUTH",
                outcome: "SUCCESS",
              },
            });
            return s;
          });
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            sessionId: session.id,
            version: user.sessionVersion,
          };
        } catch {
          await securityEvent("AUTH_LOGIN_DENIED", digest);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as typeof user & { sessionId: string; version: number };
        token.sessionId = u.sessionId;
        token.version = u.version;
      }
      return token;
    },
    async session({ session, token }) {
      session.staffId = token.sub;
      session.staffSessionId = token.sessionId as string;
      session.staffVersion = token.version as number;
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.sessionId) {
        await db.$transaction(async (tx) => {
          await tx.staffSession.updateMany({
            where: { id: token.sessionId as string },
            data: { revoked: true },
          });
          await tx.auditEvent.createMany({
            data: {
              actorId: token.sub,
              actorRole: "AUTH",
              action: "AUTH_LOGOUT",
              entityType: "SECURITY",
              entityId: token.sub ?? "unknown",
              changes: {},
              correlationId: crypto.randomUUID(),
              source: "AUTH",
              outcome: "SUCCESS",
            },
          });
        });
      }
    },
  },
  logger: { error() {}, warn() {}, debug() {} },
};
export async function getActor(
  required: "STAFF" | "ADMIN" = "STAFF",
): Promise<Actor> {
  await ensureRuntime();
  const session = await getServerSession(authOptions);
  if (!session?.staffId || !session.staffSessionId) {
    await securityEvent("ACCESS_DENIED", "anonymous");
    throw new DomainError("Please sign in with a staff account.", 401);
  }
  const [user, record] = await Promise.all([
    db.staffUser.findUnique({ where: { id: session.staffId } }),
    db.staffSession.findUnique({ where: { id: session.staffSessionId } }),
  ]);
  if (
    !user ||
    !record ||
    record.userId !== user.id ||
    record.revoked ||
    record.expiresAt < new Date() ||
    user.sessionVersion !== session.staffVersion ||
    !canAccess(user.role, user.suspended, true, required)
  ) {
    await securityEvent("ACCESS_DENIED", session.staffId, session.staffId);
    throw new DomainError("Staff access is not permitted.", 403);
  }
  return {
    id: user.id,
    role: user.role,
    sessionId: record.id,
    authenticatedAt: record.authenticatedAt,
  };
}
export async function assertCsrf(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000")
    .origin;
  if (origin !== expected)
    throw new DomainError("Invalid request origin.", 403);
}
export async function pageActor() {
  try {
    return await getActor();
  } catch {
    return null;
  }
}
export async function freshAdmin() {
  const actor = await getActor("ADMIN");
  if (Date.now() - actor.authenticatedAt.getTime() > 10 * 60 * 1000)
    throw new DomainError(
      "Sign out and authenticate again before exporting.",
      403,
    );
  return actor;
}
