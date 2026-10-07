import { StaffShell } from "@/components/staff-shell";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <StaffShell area="admin">{children}</StaffShell>;
}
