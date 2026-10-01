import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { connectChannelFn, disconnectChannelFn, listChannelsFn, testChannelFn } from "@/api/channels";
import { errorMessage } from "@/data/mutations";
import { useAppMode } from "@/data/store";
import { PROVIDERS, PROVIDER_INFO, type Provider } from "@/data/notify-providers";
import { ProviderLogo } from "./provider-logos";
import { Button, MachineLabel, Tag } from "./primitives";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2 py-1.5 text-[12px] outline-none focus:border-signal";

const WALKTHROUGH: Partial<Record<Provider, string>> = { slack: "connect-slack", telegram: "connect-telegram" };

/**
 * Where notifications go. Each provider is connected from here rather than from a file on the
 * server, and nothing is stored until it has actually delivered a test.
 */
export function NotificationChannel() {
  const mode = useAppMode();
  const client = useQueryClient();
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const channels = useQuery({
    queryKey: ["notification-channels"] as const,
    queryFn: () => listChannelsFn(),
    enabled: mode === "live",
  });

  const refresh = () => client.invalidateQueries({ queryKey: ["notification-channels"] });

  const connect = useMutation({
    mutationFn: (data: { provider: string; values: Record<string, string> }) => connectChannelFn({ data }),
    onSuccess: async (result) => {
      await refresh();
      setConnecting(null);
      setValues({});
      const retired = (result as { superseded?: string[] }).superseded ?? [];
      toast.success(
        retired.length
          ? `${PROVIDER_INFO[result.provider as Provider].name} is now the only endpoint — ${retired.map((p) => PROVIDER_INFO[p as Provider].name).join(" and ")} stopped receiving`
          : `${PROVIDER_INFO[result.provider as Provider].name} connected — a test has already arrived`,
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const test = useMutation({
    mutationFn: (channelId: string) => testChannelFn({ data: { channelId } }),
    onSuccess: async () => {
      await refresh();
      toast.success("Test notification delivered");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const disconnect = useMutation({
    mutationFn: (channelId: string) => disconnectChannelFn({ data: { channelId } }),
    onSuccess: async () => {
      await refresh();
      toast.success("Channel disconnected");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (mode === "demo") {
    return (
      <div className="space-y-2 px-4 py-4" data-testid="notification-channel">
        <p className="text-[13px] text-muted-foreground">
          Demo mode has no database, so channels cannot be connected here.
        </p>
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((provider) => (
            <span key={provider} className="machine inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1">
              <ProviderLogo provider={provider} />
              {PROVIDER_INFO[provider].name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const connected = channels.data ?? [];
  const busy = connect.isPending || test.isPending || disconnect.isPending;

  return (
    <div className="space-y-4 px-4 py-4" data-testid="notification-channel">
      {connected.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing is connected, so notifications wait here until you open the app. Connect one below.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="connected-channels">
          {connected.map((channel) => (
            <li
              key={channel.id}
              data-testid={`channel-${channel.id}`}
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-border px-3 py-2",
                // Retired channels stay listed so switching back is a reconnection rather
                // than a hunt for a credential, but they must not read as live.
                !channel.enabled && "opacity-50",
              )}
            >
              <span className="flex items-center gap-2 text-[13px]">
                <ProviderLogo provider={channel.provider} />
                {PROVIDER_INFO[channel.provider].name}
                <span className="machine text-muted-foreground">{channel.label}</span>
              </span>
              <span className="flex items-center gap-2">
                {!channel.enabled ? (
                  <Tag>RETIRED</Tag>
                ) : channel.lastError ? (
                  <Tag tone="warn">LAST SEND FAILED</Tag>
                ) : (
                  <Tag tone="signal">RECEIVING</Tag>
                )}
                <Button size="sm" disabled={busy} onClick={() => test.mutate(channel.id)}>
                  Send a test
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => disconnect.mutate(channel.id)}>
                  Disconnect
                </Button>
              </span>
              {channel.lastError && <p className="w-full text-[12px] text-warn">{channel.lastError}</p>}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[13px] text-muted-foreground" data-testid="one-endpoint-note">
        Notifications go to one endpoint. Connecting another elects it and retires this one — the
        credential is kept, so switching back is a reconnection rather than a hunt. A digest
        arriving in two places is read in neither.
      </p>

      {connecting === null ? (
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((provider) => (
            <Button key={provider} size="sm" onClick={() => { setConnecting(provider); setValues({}); }}>
              <span className="flex items-center gap-1.5">
                <ProviderLogo provider={provider} />
                Connect {PROVIDER_INFO[provider].name}
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <div className="space-y-3 rounded-[3px] border border-border p-3" data-testid="connect-form">
          <div className="flex items-center gap-2">
            <ProviderLogo provider={connecting} className="h-5 w-5" />
            <span className="text-[13px] font-medium">Connect {PROVIDER_INFO[connecting].name}</span>
          </div>
          <p className="text-[13px] text-muted-foreground">{PROVIDER_INFO[connecting].summary}</p>

          <ol className="space-y-1">
            {PROVIDER_INFO[connecting].steps.map((step, index) => (
              <li key={index} className="flex gap-2 text-[12px] text-muted-foreground">
                <span className="machine text-signal">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {WALKTHROUGH[connecting] && (
            <Link to="/walkthroughs" search={{ open: WALKTHROUGH[connecting] }} className="machine block text-signal hover:underline">
              OPEN THE FULL WALKTHROUGH →
            </Link>
          )}

          {PROVIDER_INFO[connecting].fields.map((field) => (
            <label key={field.key} className="block space-y-1">
              <MachineLabel>{field.label}</MachineLabel>
              <input
                aria-label={field.label}
                className={inputCls}
                type={field.secret ? "password" : "text"}
                placeholder={field.placeholder}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
              {field.help && <span className="machine block normal-case tracking-normal text-muted-foreground">{field.help}</span>}
            </label>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={busy || PROVIDER_INFO[connecting].fields.some((f) => !(values[f.key] ?? "").trim())}
              onClick={() => connect.mutate({ provider: connecting, values })}
            >
              {connect.isPending ? "Testing…" : "Connect and send a test"}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => { setConnecting(null); setValues({}); }}>
              Cancel
            </Button>
          </div>
          <MachineLabel className="block">NOTHING IS SAVED UNTIL A TEST ACTUALLY ARRIVES</MachineLabel>
        </div>
      )}
    </div>
  );
}
