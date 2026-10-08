import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { DomainError } from "@/lib/domain";
import { StaffNavigation } from "./staff-navigation";
import { Wordmark } from "./wordmark";
import { Logout } from "./login-form";

export async function StaffShell({
  children,
  area,
}: {
  children: React.ReactNode;
  area: "admin" | "moderator";
}) {
  let actor;
  try {
    actor = await getActor();
  } catch (e) {
    if (e instanceof DomainError && [401, 403].includes(e.status))
      redirect("/staff");
    throw e;
  }
  if (area === "admin" && actor.role !== "ADMIN") redirect("/moderator");
  const base = actor.role === "ADMIN" ? "/admin" : "/moderator";
  return (
    <div className="wrap staff-layout" lang="en">
      <aside className="sidebar">
        <div className="staff-meta">
          <Wordmark />
          <span className="badge">
            {actor.role === "ADMIN" ? "Admin" : "Moderator"}
          </span>
          <p className="text-xs muted">
            Operations workspace
            <br />
            Malaysia time
          </p>
          <Logout />
        </div>
        <StaffNavigation base={base} admin={actor.role === "ADMIN"} />
      </aside>
      <section className="staff-main">{children}</section>
    </div>
  );
}
