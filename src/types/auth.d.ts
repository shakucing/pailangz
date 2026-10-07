import "next-auth";
declare module "next-auth" {
  interface Session {
    staffId?: string;
    staffSessionId?: string;
    staffVersion?: number;
  }
}
