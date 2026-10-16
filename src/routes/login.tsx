import { createFileRoute, redirect } from "@tanstack/react-router";

import { z } from "zod";

import { safeAdminRedirect } from "@/lib/auth/redirect";
import { getAdminSession } from "@/server/admin-auth";

import { AdminLogin } from "./-components/admin-login";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ search }) => {
    const session = await getAdminSession();
    if (session.status === "authenticated") {
      throw redirect({ to: safeAdminRedirect(search.redirect), replace: true });
    }
  },
  component: AdminLogin,
});
