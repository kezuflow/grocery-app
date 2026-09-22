import { toast } from "sonner";

export type AdminSuccessFeedback = {
  title: string;
  description?: string;
};

/**
 * Admin feedback policy: a transient toast only ever reports what Core has
 * already confirmed. Pending, failed, conflict and partial-outcome states
 * stay in persistent inline banners (CommandBanner / AdminPageState) so the
 * operator cannot lose them; nothing here may show a financial or
 * operational commitment before Core confirms it.
 */
export function notifyCommandSuccess(title: string, description?: string, id?: string) {
  toast.success(title, id === undefined ? { description } : { description, id });
}

/** For retryable browser-side failures only (for example a clipboard write). */
export function notifyCommandError(title: string, description?: string) {
  toast.error(title, { description });
}
