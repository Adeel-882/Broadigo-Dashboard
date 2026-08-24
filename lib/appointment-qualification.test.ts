import { describe, expect, it } from "vitest";
import { classifyAppointmentQualification, latestAssignedCloserDisposition } from "@/lib/appointment-qualification";

describe("appointment qualification classifier", () => {
  it.each(["Qualified", "qualified", "QUALIFIED FOLLOWUP", "Qualified. Good prospect.", "qualified, sale."])("classifies %s as qualified", (text) => {
    expect(classifyAppointmentQualification(text)).toBe("QUALIFIED");
  });
  it.each(["Not qualified.", "not qualified", "NOT QUALIFIED"])("classifies %s as not qualified", (text) => {
    expect(classifyAppointmentQualification(text)).toBe("NOT_QUALIFIED");
  });
  it.each(["No pickup", "voicemail", "follow up Thursday", "random conversation", ""])("classifies %s as unknown", (text) => {
    expect(classifyAppointmentQualification(text)).toBe("UNKNOWN");
  });
  it("never lets not qualified satisfy positive detection", () => {
    expect(classifyAppointmentQualification("Not qualified")).not.toBe("QUALIFIED");
  });
});

describe("latest assigned closer disposition", () => {
  it("uses the latest explicit disposition from the assigned closer", () => {
    expect(latestAssignedCloserDisposition([
      { text: "Not qualified", ts: "1.1", user: "U1" },
      { text: "Qualified", ts: "1.2", user: "U1" },
    ], "U1")?.status).toBe("QUALIFIED");
    expect(latestAssignedCloserDisposition([
      { text: "Qualified", ts: "1.1", user: "U1" },
      { text: "Not qualified", ts: "1.2", user: "U1" },
    ], "U1")?.status).toBe("NOT_QUALIFIED");
  });
  it("ignores random employees and neutral replies", () => {
    expect(latestAssignedCloserDisposition([
      { text: "Qualified", ts: "1.2", user: "U2" },
      { text: "voicemail", ts: "1.3", user: "U1" },
    ], "U1")).toBeNull();
  });
});
