export function safeAdminRedirect(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard/default";
  }
  return value;
}
