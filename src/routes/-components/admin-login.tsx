import { useState } from "react";

import { useNavigate, useSearch } from "@tanstack/react-router";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Command, LoaderCircle } from "lucide-react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { loginAdmin } from "@/lib/api/admin-session";
import { type AdminLoginFormValues, adminLoginSchema } from "@/lib/auth/admin-login-form";
import { getSafeLoginError, type LoginErrorDetails } from "@/lib/auth/login-error";
import { safeAdminRedirect } from "@/lib/auth/redirect";

export function AdminLogin() {
  const navigate = useNavigate({ from: "/login" });
  const search = useSearch({ from: "/login" });
  const form = useForm<AdminLoginFormValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { email: "", password: "" },
  });
  const [apiError, setApiError] = useState<LoginErrorDetails | null>(null);

  async function onSubmit(values: AdminLoginFormValues) {
    setApiError(null);
    try {
      await loginAdmin(values.email.trim(), values.password);
      await navigate({ to: safeAdminRedirect(search.redirect), replace: true });
    } catch (error) {
      setApiError(getSafeLoginError(error));
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-10" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Command className="size-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">ورود به پنل EggShip</CardTitle>
          <CardDescription>برای مدیریت سفارش‌ها و عملیات فروشگاه وارد شوید.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            {apiError ? (
              <div
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm"
                role="alert"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div className="space-y-1">
                  <p>{apiError.message}</p>
                  {apiError.requestId ? (
                    <p className="text-xs opacity-80">شناسه درخواست: {apiError.requestId}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
            <FieldGroup className="gap-4">
              <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <Field className="gap-1.5" data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="admin-email">ایمیل</FieldLabel>
                    <Input
                      {...field}
                      id="admin-email"
                      type="email"
                      autoComplete="username"
                      dir="ltr"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                  <Field className="gap-1.5" data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="admin-password">رمز عبور</FieldLabel>
                    <Input
                      {...field}
                      id="admin-password"
                      type="password"
                      autoComplete="current-password"
                      dir="ltr"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </FieldGroup>
            <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
              {form.formState.isSubmitting ? "در حال ورود..." : "ورود"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
