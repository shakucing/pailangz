import { describe, expect, it } from "vitest";
import { countryCode } from "../src/lib/countries";
import {
  memberFieldKind,
  memberFieldOptions,
  normalizeMemberField,
} from "../src/lib/member-fields";

describe("member country and status choices", () => {
  it("recognizes country names, ISO codes and configured country columns", () => {
    expect(countryCode(" Indonesia ")).toBe("ID");
    expect(countryCode("my")).toBe("MY");
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("Jepun")).toBe("JP");
    expect(memberFieldKind("Residence", "Residence")).toBe("country");
    expect(memberFieldKind(" Country ")).toBe("country");
    expect(memberFieldKind("STATUS")).toBe("status");
    expect(memberFieldKind("State/Province")).toBeUndefined();
  });

  it("rejects unknown countries and statuses while allowing unspecified values", () => {
    expect(normalizeMemberField("country", "Atlantis")).toBeUndefined();
    expect(normalizeMemberField("country", "ZZ")).toBeUndefined();
    for (const value of ["ADMIN", "approved", "archived", "pending"])
      expect(normalizeMemberField("status", value)).toBeUndefined();
    expect(normalizeMemberField("status", " INACTIVE ")).toBe("inactive");
    expect(normalizeMemberField("status", "Active")).toBe("active");
    expect(normalizeMemberField("status", " ")).toBe("");
    expect(normalizeMemberField("country", "")).toBe("");
  });

  it("preselects imported names without silently rewriting them on save", () => {
    const choices = memberFieldOptions("country", "Indonesia");
    expect(choices.find((option) => option.label === "Indonesia")?.value).toBe(
      "Indonesia",
    );
    expect(choices.find((option) => option.label === "Malaysia")?.value).toBe(
      "MY",
    );
    expect(choices).toHaveLength(250);
    expect(new Set(choices.map((option) => option.value)).size).toBe(250);
    expect(memberFieldOptions("status", "ACTIVE")).toContainEqual({
      value: "ACTIVE",
      label: "Active",
    });
  });

  it("keeps unknown saved values visible without offering them to other records", () => {
    expect(memberFieldOptions("status", "legacy status")[0]).toEqual({
      value: "legacy status",
      label: "Current value: legacy status (unrecognized)",
    });
    expect(memberFieldOptions("country", "legacy country")[0].value).toBe(
      "legacy country",
    );
    expect(
      memberFieldOptions("status", "").map((option) => option.value),
    ).toEqual(["", "active", "inactive"]);
  });
});
