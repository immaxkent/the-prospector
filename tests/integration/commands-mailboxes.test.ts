import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  GMAIL_SCOPES,
  assignEndeavourMailbox,
  connectGoogleMailbox,
  disconnectMailbox,
  updateMailboxLimits,
  type GoogleTokenSet,
} from "../../src/server/commands/mailboxes";
import { unsealJson } from "../../src/server/crypto/tokens";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { DEFAULT_MAILBOX_LIMITS } from "../../src/server/domain/mailbox";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());
beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

const key = randomBytes(32);
const scope = GMAIL_SCOPES.join(" ");
// Distinctive so "the ciphertext does not contain it" cannot pass or fail by chance.
const PLAINTEXT_REFRESH = "refresh-token-plaintext-marker";
const mailbox = async (address: string) => (await db.select().from(t.mailboxes).where(eq(t.mailboxes.address, address)))[0]!;

describe("connectGoogleMailbox", () => {
  it("stores sealed tokens and default limits for a new mailbox", async () => {
    const result = await connectGoogleMailbox(db, key, {
      address: "Max@Deca.example",
      displayName: "Max at Decastream",
      tokens: { accessToken: "at", refreshToken: PLAINTEXT_REFRESH, expiresAt: 1000, scope },
    });
    expect(result).toMatchObject({ address: "max@deca.example", reconnected: false });
    const row = await mailbox("max@deca.example");
    expect(row).toMatchObject({ status: "connected", limits: DEFAULT_MAILBOX_LIMITS });
    expect(row.tokenCiphertext).not.toContain(PLAINTEXT_REFRESH);
    expect(unsealJson<GoogleTokenSet>(row.tokenCiphertext!, key)).toMatchObject({ refreshToken: PLAINTEXT_REFRESH, accessToken: "at" });
  });

  it("keeps the stored refresh token when Google omits it on reconnect", async () => {
    const tokens = { accessToken: "at1", refreshToken: "rt1", expiresAt: 1, scope };
    await connectGoogleMailbox(db, key, { address: "a@x.example", displayName: "", tokens });
    await disconnectMailbox(db, { mailboxId: (await mailbox("a@x.example")).id });
    await expect(
      connectGoogleMailbox(db, key, { address: "a@x.example", displayName: "", tokens: { accessToken: "at2", expiresAt: 2, scope } }),
    ).rejects.toMatchObject({ code: "invalid" });

    await connectGoogleMailbox(db, key, { address: "b@x.example", displayName: "", tokens });
    const reconnected = await connectGoogleMailbox(db, key, {
      address: "b@x.example",
      displayName: "B",
      tokens: { accessToken: "at2", expiresAt: 2, scope },
    });
    expect(reconnected.reconnected).toBe(true);
    const row = await mailbox("b@x.example");
    expect(unsealJson<GoogleTokenSet>(row.tokenCiphertext!, key)).toMatchObject({ refreshToken: "rt1", accessToken: "at2" });
  });

  it("refuses a grant without Gmail access", async () => {
    await expect(
      connectGoogleMailbox(db, key, {
        address: "c@x.example",
        displayName: "",
        tokens: { accessToken: "a", refreshToken: "r", expiresAt: 1, scope: "openid email" },
      }),
    ).rejects.toThrow("Gmail send and read access");
  });
});

describe("limits, disconnection and assignment", () => {
  it("validates and saves limits", async () => {
    const good = { ...DEFAULT_MAILBOX_LIMITS, dailyCap: 20, weeklyCap: 80, warmup: { startedOn: "2026-09-17", startCap: 5, incrementPerDay: 2 } };
    await updateMailboxLimits(db, { mailboxId: FIXTURE_IDS.mailbox, limits: good });
    expect((await mailbox("max@consulting.example")).limits).toEqual(good);

    for (const bad of [
      { ...good, weeklyCap: 10 },
      { ...good, warmup: { ...good.warmup, startCap: 50 } },
      { ...good, timezone: "Mars/Olympus" },
      { ...good, dailyCap: 0 },
    ]) {
      await expect(updateMailboxLimits(db, { mailboxId: FIXTURE_IDS.mailbox, limits: bad })).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("disconnecting clears tokens and blocks assignment until reconnected", async () => {
    await disconnectMailbox(db, { mailboxId: FIXTURE_IDS.mailbox });
    expect(await mailbox("max@consulting.example")).toMatchObject({ status: "disconnected", tokenCiphertext: null });
    await expect(
      assignEndeavourMailbox(db, { endeavourId: FIXTURE_IDS.endeavour, mailboxId: FIXTURE_IDS.mailbox }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("assigning a mailbox updates the endeavour and its spec", async () => {
    const { id } = await connectGoogleMailbox(db, key, {
      address: "deca@x.example",
      displayName: "Deca",
      tokens: { accessToken: "a", refreshToken: "r", expiresAt: 1, scope },
    });
    await assignEndeavourMailbox(db, { endeavourId: FIXTURE_IDS.endeavour, mailboxId: id });
    const [e] = await db.select().from(t.endeavours);
    expect(e!.mailboxId).toBe(id);
    expect(e!.spec.mailboxId).toEqual({ state: "confirmed", value: id });
  });
});
