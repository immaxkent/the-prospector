/**
 * Changing how an endeavour paces itself. Unlike the spec, this is not versioned: these are
 * dials, and a record of every nudge would bury the strategy history that matters.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavours } from "../db/schema";
import { normaliseSettings, type EndeavourSettings } from "../domain/endeavour-settings";
import { conflict, notFound } from "./errors";
import { recordEvent } from "./events";

export interface UpdateEndeavourSettingsInput {
  endeavourId: string;
  pacing: EndeavourSettings["pacing"];
  followUpDays: number[];
}

export async function updateEndeavourSettings(db: Database, input: UpdateEndeavourSettingsInput) {
  return db.transaction(async (tx) => {
    const [endeavour] = await tx.select().from(endeavours).where(eq(endeavours.id, input.endeavourId)).for("update");
    if (!endeavour) throw notFound("endeavour");
    if (endeavour.status === "archived") throw conflict("an archived endeavour cannot be reconfigured");

    // Whatever arrives is put through the same rules the defaults go through, so a value the
    // form allowed but the domain does not is corrected rather than stored.
    const settings = normaliseSettings({ pacing: input.pacing, followUpDays: input.followUpDays });
    await tx.update(endeavours).set({ settings }).where(eq(endeavours.id, endeavour.id));
    await recordEvent(tx, {
      eventType: "endeavour.settings_updated",
      entityType: "endeavour",
      entityId: endeavour.id,
      endeavourId: endeavour.id,
      subject: endeavour.name,
      detail: `sends ${settings.pacing.window.startHour}:00-${settings.pacing.window.endHour}:00 · ${settings.pacing.minGapMinutes}-${settings.pacing.maxGapMinutes} min apart · follow-ups ${settings.followUpDays.join(", ") || "off"}`,
      data: settings as unknown as Record<string, unknown>,
    });
    return settings;
  }, { isolationLevel: "read committed" });
}

/** The settings as they stand, with every default filled in. */
export async function loadEndeavourSettings(db: Database, endeavourId: string) {
  const [endeavour] = await db.select({ settings: endeavours.settings }).from(endeavours).where(eq(endeavours.id, endeavourId));
  if (!endeavour) throw notFound("endeavour");
  return normaliseSettings(endeavour.settings);
}
