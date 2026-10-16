import { cn } from "cn";
import { siGoogle } from "simple-icons";

import { SimpleIcon } from "@/components/simple-icon";
import { Button } from "@/components/ui/button";

export function GoogleButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button variant="secondary" className={cn(className)} disabled {...props}>
      <SimpleIcon icon={siGoogle} className="size-4" />
      ورود با Google (به‌زودی)
    </Button>
  );
}
