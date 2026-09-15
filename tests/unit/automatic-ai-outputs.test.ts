import { describe, expect, it } from "vitest";
import { resolveAutomaticOutputTypes } from "@/lib/settings/metadata";
import { parseSettingsForm } from "@/lib/settings/form";
import { settingsProcessingTypes } from "@/lib/settings/types";

describe("explicit automatic output consent", () => {
  it("keeps dormant settings inert and preserves explicit timeline", () => {
    expect(resolveAutomaticOutputTypes({ vosio_settings: {
      autoProcessAfterTranscription: true, autoProcessingTypes: ["summary"],
      autoTimelineAfterTranscription: true
    } })).toEqual(["timeline_chapters"]);
  });
  it.each(settingsProcessingTypes)("supports independent %s consent", (type) => {
    expect(resolveAutomaticOutputTypes({ vosio_settings: { automaticOutputTypes: [type] } })).toEqual([type]);
  });
  it("resolves all six in canonical order and fails closed on invalid values", () => {
    expect(resolveAutomaticOutputTypes({ vosio_settings: {
      automaticOutputTypes: [...settingsProcessingTypes].reverse(), autoTimelineAfterTranscription: true
    } })).toEqual([...settingsProcessingTypes, "timeline_chapters"]);
    expect(resolveAutomaticOutputTypes({ vosio_settings: { automaticOutputTypes: ["unknown"] } })).toEqual([]);
    expect(resolveAutomaticOutputTypes({ vosio_settings: { automaticOutputTypes: ["unknown"], autoTimelineAfterTranscription: true } })).toEqual(["timeline_chapters"]);
    expect(resolveAutomaticOutputTypes({ vosio_settings: { automaticOutputTypes: ["summary"], defaultOpenaiModel: "unknown" } })).toEqual([]);
  });
  it("round trips an explicit empty form and ignores dormant selections", () => {
    const form = new FormData();
    form.set("autoProcessAfterTranscription", "on");
    form.set("autoProcessingTypes", "summary");
    expect(parseSettingsForm(form).automaticOutputTypes).toEqual([]);
    form.append("automaticOutputTypes", "crm_note");
    expect(parseSettingsForm(form).automaticOutputTypes).toEqual(["crm_note"]);
  });
});
