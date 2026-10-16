import { ApiRequestError } from "../api/transport.ts";

const GENERIC_LOGIN_ERROR = "ورود انجام نشد. لطفاً اتصال و اطلاعات واردشده را بررسی کنید.";

export type LoginErrorDetails = {
  message: string;
  requestId: string | null;
};

export function getSafeLoginError(error: unknown): LoginErrorDetails {
  if (!(error instanceof ApiRequestError)) {
    return { message: GENERIC_LOGIN_ERROR, requestId: null };
  }

  const message = error.envelope?.error?.message?.trim();
  return {
    message: message || GENERIC_LOGIN_ERROR,
    requestId: error.requestId,
  };
}

export { GENERIC_LOGIN_ERROR };
