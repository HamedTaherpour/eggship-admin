import { createFileRoute, type ErrorComponentProps, Link, Outlet, redirect } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { getAdminIdentity } from "@/lib/api/admin-session";
import { ApiRequestError } from "@/lib/api/transport";
import { getAdminSession } from "@/server/admin-auth";

export const Route = createFileRoute("/(main)")({
  errorComponent: AdminApiUnavailable,
  beforeLoad: async ({ location }) => {
    let session = await getAdminSession();
    if (session.status === "unauthenticated" && typeof window !== "undefined") {
      try {
        session = { status: "authenticated", admin: await getAdminIdentity() };
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 403) session = { status: "forbidden" };
        else if (error instanceof ApiRequestError && error.status === 401) session = { status: "unauthenticated" };
        else session = { status: "unavailable" };
      }
    }
    if (session.status === "unauthenticated" || session.status === "forbidden") {
      throw redirect({ to: "/login", search: { redirect: location.href }, replace: true });
    }
    if (session.status === "unavailable") {
      throw new Error("ADMIN_API_UNAVAILABLE");
    }
    return { admin: session.admin };
  },
  component: () => <Outlet />,
});

function AdminApiUnavailable({ reset }: ErrorComponentProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="font-semibold text-2xl">سرویس مدیریت موقتاً در دسترس نیست</h1>
        <p className="text-muted-foreground">احراز هویت انجام نشد. لطفاً اتصال را بررسی کنید و دوباره تلاش کنید.</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>تلاش دوباره</Button>
        <Button nativeButton={false} variant="outline" render={<Link to="/login" replace />}>
          ورود
        </Button>
      </div>
    </main>
  );
}
