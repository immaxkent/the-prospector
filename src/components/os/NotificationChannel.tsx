import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { sendTestNotificationFn } from "@/api/notifications";
import { errorMessage } from "@/data/mutations";
import { useAppMode, useDataset } from "@/data/store";
import { Button, MachineLabel, StatusDot } from "./primitives";

const CHANNELS: Record<string, { label: string; detail: string }> = {
  slack: {
    label: "SLACK",
    detail: "Posted to the channel the incoming webhook belongs to.",
  },
  ntfy: { label: "NTFY", detail: "Pushed to the ntfy topic." },
  webhook: { label: "WEBHOOK", detail: "Posted as JSON to your own endpoint." },
  in_app: {
    label: "IN APP ONLY",
    detail:
      "Nothing is configured, so notifications wait here until you open the app. Set NOTIFY_SLACK_WEBHOOK_URL on the server to have them reach Slack.",
  },
};

/** Where notifications go, and a way to prove it before trusting it unattended. */
export function NotificationChannel() {
  const mode = useAppMode();
  const { status } = useDataset();
  const { channel, destination } = status.notifications;
  const described = CHANNELS[channel] ?? CHANNELS["in_app"]!;

  const test = useMutation({
    mutationFn: () => sendTestNotificationFn(),
    onSuccess: (result) => toast.success(`Test notification delivered to ${result.channel}`),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-3 px-4 py-4" data-testid="notification-channel">
      <div className="flex items-center gap-2">
        <StatusDot tone={channel === "in_app" ? "warn" : "ok"} />
        <MachineLabel tone={channel === "in_app" ? "muted" : "signal"}>{described.label}</MachineLabel>
        {destination && <span className="machine text-muted-foreground">{destination}</span>}
      </div>
      <p className="text-[13px] text-muted-foreground">{described.detail}</p>
      <Button
        size="sm"
        disabled={mode !== "live" || channel === "in_app" || test.isPending}
        onClick={() => test.mutate()}
      >
        {test.isPending ? "Sending…" : "Send a test notification"}
      </Button>
      {mode !== "live" && (
        <MachineLabel className="block">DEMO MODE: NOTHING IS ACTUALLY SENT</MachineLabel>
      )}
    </div>
  );
}
