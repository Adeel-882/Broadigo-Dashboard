import { describe, expect, it } from "vitest";
import { CURRENT_ISA_ROSTER } from "@/lib/isa-roster";

describe("current ISA roster", () => {
  it("preserves the ten explicit real, pseudo and email mappings", () => {
    expect(CURRENT_ISA_ROSTER).toHaveLength(10);
    expect(CURRENT_ISA_ROSTER.map(({ realName, pseudoName, email }) => [realName, pseudoName, email])).toEqual([
      ["Asif Hazoor", "Eric Williams", "ericwilliams@leadsedge.us"],
      ["Syed Ali Jan", "Steve Coulston", "stevecoulston@leadsedge.us"],
      ["Alishba Zareh", "Lizbert", "lizbert@leadsedge.us"],
      ["Aishah Arif", "Ella Johnson", "ellajohnson@leadsedge.us"],
      ["Muhammad Eman", "Justin Clay", "adamgrant@leadsedge.us"],
      ["Saad Ali", "Christian Knight", "mikeweston@leadsedge.us"],
      ["Dilshad Ullah Danish", "David Klein", "rickjohnson@leadsedge.us"],
      ["Muhammad Zeeshan", "Brian Adams", "brianadams@leadsedge.us"],
      ["Abdul Wali", "Oliver Smith", "oliversmith@leadsedge.us"],
      ["Nawal Tariq", "Emma James", "emmajames@leadsedge.us"],
    ]);
  });
});
