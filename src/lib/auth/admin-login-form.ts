import { z } from "zod";

export const adminLoginSchema = z.object({
  email: z.email({ message: "ایمیل معتبر وارد کنید." }),
  password: z.string().min(1, { message: "رمز عبور را وارد کنید." }),
});

export type AdminLoginFormValues = z.infer<typeof adminLoginSchema>;
