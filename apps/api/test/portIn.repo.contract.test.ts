import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PortInNumberTakenError, type NewPortIn } from "../src/repo/portIn.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres port-in stores (supabase/migrations/0009_port_in.sql).
// Postgres runs only with TEST_DATABASE_URL (a scratch database with every migration applied).
const pgUrl = process.env.TEST_DATABASE_URL;

const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 1 }), Boolean(pgUrl)],
];

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`port-in repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) await repo.sql.unsafe("truncate port_in_numbers, port_in_requests, telecom_accounts, users cascade");
      else repo = make();
    });

    async function draft(): Promise<NewPortIn> {
      const user = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A" });
      const account = await repo.createAccount({ ownerUserId: user.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      return {
        telecomAccountId: account.id,
        userId: user.id,
        businessId: null,
        kind: "consumer",
        currentCarrier: "Bell",
        customerType: "individual",
        customerName: "A",
        authorizedName: "A",
        authorizedEmail: "a@example.ca",
        serviceAddress: { street: "1 rue X", unit: null, city: "Montréal", province: "QC", postalCode: "H2X 1Y4" },
        accountNumberEncrypted: "v1.x",
        pinEncrypted: null,
        temporaryNumber: null,
        keepTemporaryNumber: false,
        desiredDate: null,
        feeCents: 0,
      };
    }

    it("creates, reads, lists and updates requests with their numbers", async () => {
      const d = await draft();
      const p = await repo.portIns.create(d, ["+14505550124", "+14505550123"]);
      expect(p.request).toMatchObject({ status: "pending_signature", carrierRef: null, serviceAddress: d.serviceAddress, keepTemporaryNumber: false });
      expect(p.numbers.map((n) => [n.e164, n.status])).toEqual([
        ["+14505550123", "pending"],
        ["+14505550124", "pending"],
      ]);
      await repo.portIns.update(p.request.id, { status: "submitted", carrierRef: "KWabc", loaSignedAt: new Date("2026-10-14T14:00:00Z"), loaSignedName: "A" });
      expect((await repo.portIns.getByCarrierRef("KWabc"))!.request).toMatchObject({ status: "submitted", loaSignedName: "A" });
      await repo.portIns.updateNumber(p.numbers[0]!.id, { status: "foc_scheduled", focDate: "2026-10-21" });
      expect((await repo.portIns.get(p.request.id))!.numbers[0]).toMatchObject({ status: "foc_scheduled", focDate: "2026-10-21" });
      expect((await repo.portIns.listByAccounts([d.telecomAccountId])).map((x) => x.request.id)).toEqual([p.request.id]);
      expect(await repo.portIns.listByAccounts([])).toEqual([]);
    });

    it("allows one open port per number", async () => {
      const p = await repo.portIns.create(await draft(), ["+14505550123"]);
      expect((await repo.portIns.findOpenNumber("+14505550123"))!.portInId).toBe(p.request.id);
      await expect(repo.portIns.create(await draft(), ["+14505550123"])).rejects.toBeInstanceOf(PortInNumberTakenError);
      await repo.portIns.updateNumber(p.numbers[0]!.id, { status: "canceled" });
      expect(await repo.portIns.findOpenNumber("+14505550123")).toBeNull();
      await expect(repo.portIns.create(await draft(), ["+14505550123"])).resolves.toBeTruthy();
    });
  });
}
