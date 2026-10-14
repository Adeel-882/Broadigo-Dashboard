import { describe, expect, it } from "vitest";
import { dockAuthorLabel } from "@/lib/slack/dock-author";

describe("dock author labels", () => {
  it("keeps the canonical employee and pseudo separate", () => expect(dockAuthorLabel("Asif Hazoor","Eric Williams","Asif Hazoor (Eric)")).toBe("Asif Hazoor / Eric Williams"));
  it("uses the Slack display when no pseudo is configured", () => expect(dockAuthorLabel("Ryan Voss",null,"Ryan Voss-Umar")).toBe("Ryan Voss-Umar"));
  it("never promotes an author into a recipient", () => expect(dockAuthorLabel("Dameon Wolfe",null,"Dameon Wolfe")).toBe("Dameon Wolfe"));
});
