/**
 * Changing how an endeavour paces itself. Unlike the spec, this is not versioned: these are
 * dials, and a record of every nudge would bury the strategy history that matters.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavours } from "../db/schema";
import { normaliseSettings, type EndeavourSettings } from "../domain/endeavour-settings";
import { prospectingProblem } from "../domain/prospecting";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent } from "./events";

export interface UpdateEndeavourSettingsInput {
  endeavourId: string;
  pacing: EndeavourSettings["pacing"];
  followUpDays: number[];
  /** Left out by a caller that is not editing them, which must not reset them. */
  prospecting?: EndeavourSettings["prospecting"];
}

export async function updateEndeavourSettings(db: Database, input: UpdateEndeavourSettingsInput) {
  return db.transaction(async (tx) => {
    const [endeavour] = await tx.select().from(endeavours).where(eq(endeavours.id, input.endeavourId)).for("update");
    if (!endeavour) throw notFound("endeavour");
    if (endeavour.status === "archived") throw conflict("an archived endeavour cannot be reconfigured");

    // Refused, not corrected. The stored-value path clamps so old settings cannot break an
    // endeavour; a number someone just typed is different, and silently changing it in front
    // of them tells them nothing about why they did not get what they asked for.
    if (input.prospecting) {
      const problem = prospectingProblem(input.prospecting);
      if (problem) throw invalid(problem);
    }

    // Merged over what is stored, not written over it: a caller editing pacing must not
    // reset the setpoints to their defaults by not mentioning them.
    const current = normaliseSettings(endeavour.settings);
    // Whatever arrives is put through the same rules the defaults go through, so a value the
    // form allowed but the domain does not is corrected rather than stored.
    const settings = normaliseSettings({
      pacing: input.pacing,
      followUpDays: input.followUpDays,
      prospecting: input.prospecting ?? current.prospecting,
    });
    await tx.update(endeavours).set({ settings }).where(eq(endeavours.id, endeavour.id));
    await recordEvent(tx, {
      eventType: "endeavour.settings_updated",
      entityType: "endeavour",
      entityId: endeavour.id,
      endeavourId: endeavour.id,
      subject: endeavour.name,
      detail: `sends ${settings.pacing.window.startHour}:00-${settings.pacing.window.endHour}:00 · ${settings.pacing.minGapMinutes}-${settings.pacing.maxGapMinutes} min apart · follow-ups ${settings.followUpDays.join(", ") || "off"} · up to ${settings.prospecting.maximumPending} pending, ${settings.prospecting.activeGoal} live${settings.prospecting.paused ? " · prospecting paused" : ""}`,
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
