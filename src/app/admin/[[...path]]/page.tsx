import { StaffDashboard } from "@/components/staff-dashboard";
export { staffPageMetadata as generateMetadata } from "@/lib/staff-navigation";
export const dynamic = "force-dynamic";
export default function Page(props: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <StaffDashboard {...props} area="admin" />;
}
