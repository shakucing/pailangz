import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { DomainError } from "@/lib/domain";
import { StaffNavigation } from "./staff-navigation";
import { Logout } from "./login-form";
import { Clock3 } from "lucide-react";

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
          <strong className="staff-portal-title">Staff portal</strong>
          <span className="badge">
            {actor.role === "ADMIN" ? "Admin" : "Moderator"}
          </span>
        </div>
        <StaffNavigation base={base} admin={actor.role === "ADMIN"}>
          <div className="staff-session">
            <span className="staff-timezone">
              <Clock3 size={14} aria-hidden="true" />
              Malaysia time (MYT)
            </span>
            <Logout />
          </div>
        </StaffNavigation>
      </aside>
      <section className="staff-main">{children}</section>
    </div>
  );
}
