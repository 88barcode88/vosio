import { describe, expect, it } from "vitest";
import { dedupeStructuredAiItems } from "@/lib/ai/structured-dedupe";
import { buildStructuredAiItems, emptyStructuredAiItems } from "@/lib/ai/structured-items";

const context = {
  aiOutputId: "out-1",
  processingJobId: "job-1",
  transcriptId: "transcript-1",
  userId: "user-1"
};

describe("structured AI item extraction", () => {
  it("extracts grouped action items into normalized task rows", () => {
    const payload = {
      data: {
        tasks: {
          client: [
            {
              deadline: "příští týden",
              deadline_confidence: "uncertain",
              evidence_quote: "pošlete nám podklady",
              owner_name: "Klient",
              source_type: "explicit",
              task: "Poslat podklady"
            }
          ],
          my_work: [
            {
              deadline_normalized: "2026-05-29",
              owner_name: "Míra",
              status: "waiting",
              task: "Doplnit export"
            }
          ],
          unclear: [
            {
              task: "Prověřit termín"
            }
          ]
        }
      }
    };
    const snapshot = JSON.stringify(payload);

    const result = buildStructuredAiItems(context, payload);

    expect(result.tasks).toHaveLength(3);
    expect(result.tasks.map((task) => task.owner_category)).toEqual(["Moje práce", "Klient", "Nejasné"]);
    expect(result.tasks[0]).toMatchObject({
      deadline_normalized: "2026-05-29",
      owner_name: "Míra",
      position: 1,
      status: "waiting",
      title: "Doplnit export"
    });
    expect(result.tasks[1]).toMatchObject({
      deadline: "příští týden",
      deadline_confidence: "uncertain",
      evidence_quote: "pošlete nám podklady",
      source_type: "explicit",
      title: "Poslat podklady"
    });
    expect(JSON.stringify(payload)).toBe(snapshot);
  });

  it("extracts timeline chapters into normalized chapter rows", () => {
    const result = buildStructuredAiItems(context, {
      data: {
        chapters: [
          {
            confidence: "high",
            dominant_roles: ["client_customer", "delivery_team"],
            end_time: "00:10:00",
            speakers: ["Mluvčí 1", "Mluvčí 2"],
            start_time: "00:00:00",
            summary: "Probírala se integrace.",
            title: "Integrace CRM",
            topics: ["CRM", "kalendář"]
          }
        ]
      }
    });

    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]).toMatchObject({
      confidence: "high",
      dominant_roles: ["client_customer", "delivery_team"],
      end_time: "00:10:00",
      position: 1,
      speakers: ["Mluvčí 1", "Mluvčí 2"],
      start_time: "00:00:00",
      summary: "Probírala se integrace.",
      title: "Integrace CRM",
      topics: ["CRM", "kalendář"]
    });
  });

  it("extracts meeting minutes decisions risks blockers and tasks", () => {
    const result = buildStructuredAiItems(context, {
      data: {
        action_items: [{ owner_category: "Moje práce", task: "Opravit chybu" }],
        blockers: [{ blocker: "Chybí přístup", needed_to_unblock: "Poslat pozvánku" }],
        decisions: [{ decision: "Použije se CRM evidence", status: "decided" }],
        risks: [{ impact: "Zdržení sprintu", risk: "Nejasná data" }]
      }
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({ status: "decided", title: "Použije se CRM evidence" });
    expect(result.risks.map((risk) => risk.title)).toEqual(["Nejasná data", "Chybí přístup"]);
  });

  it("stores only evidence locations resolved uniquely from saved transcript tokens", () => {
    const transcriptSegments = [
      { end_ms: 1_400, start_ms: 1_000, text: "Posleme" },
      { end_ms: 1_800, start_ms: 1_400, text: " podklady." },
      { end_ms: 2_400, start_ms: 2_000, text: "Schvalili" },
      { end_ms: 2_900, start_ms: 2_400, text: " jsme termin." },
      { end_ms: 3_400, start_ms: 3_000, text: "Chybi" },
      { end_ms: 3_900, start_ms: 3_400, text: " pristup." }
    ];
    const result = buildStructuredAiItems({ ...context, transcriptSegments }, {
      data: {
        action_items: [{
          evidence_end_ms: 99_999,
          evidence_quote: "POSLEME podklady",
          evidence_start_ms: 99_000,
          task: "Poslat podklady"
        }],
        decisions: [{
          decision: "Potvrdit termin",
          evidence_quote: "schvalili jsme termin",
          start_ms: 88_000
        }],
        risks: [{
          end_ms: 77_999,
          evidence_quote: "chybi pristup",
          risk: "Chybejici pristup"
        }]
      }
    });

    expect(result.tasks[0]).toMatchObject({ evidence_end_ms: 1_800, evidence_start_ms: 1_000 });
    expect(result.decisions[0]).toMatchObject({ evidence_end_ms: 2_900, evidence_start_ms: 2_000 });
    expect(result.risks[0]).toMatchObject({
      evidence_end_ms: 3_900,
      evidence_quote: "chybi pristup",
      evidence_start_ms: 3_000
    });
  });

  it("ignores provider evidence times when its quote is not uniquely verified", () => {
    const result = buildStructuredAiItems({
      ...context,
      transcriptSegments: [{ end_ms: 1_800, start_ms: 1_000, text: "Jiny text" }]
    }, {
      data: {
        action_items: [{
          evidence_end_ms: 20_000,
          evidence_quote: "nenalezeny dukaz",
          evidence_start_ms: 10_000,
          task: "Ukol"
        }]
      }
    });

    expect(result.tasks[0]).toMatchObject({ evidence_end_ms: null, evidence_start_ms: null });
  });

  it("separates pending confirmations from already agreed decisions", () => {
    const result = buildStructuredAiItems(context, {
      data: {
        decided_items: [{ decision: "Customer Portal se v tomto sprintu nebude řešit" }],
        decisions_to_confirm: [{ decision: "Klient potvrdí finální oprávnění" }]
      }
    });

    expect(result.decisions).toHaveLength(2);
    expect(result.decisions[0]).toMatchObject({
      position: 1,
      status: "needs_confirmation",
      title: "Klient potvrdí finální oprávnění"
    });
    expect(result.decisions[1]).toMatchObject({
      position: 2,
      status: "decided",
      title: "Customer Portal se v tomto sprintu nebude řešit"
    });
  });

  it("returns empty structured rows for invalid output json", () => {
    expect(buildStructuredAiItems(context, null)).toEqual(emptyStructuredAiItems());
    expect(buildStructuredAiItems(context, "plain text")).toEqual(emptyStructuredAiItems());
    expect(buildStructuredAiItems(context, { markdown: "bez struktury" })).toEqual(emptyStructuredAiItems());
  });

  it("deduplicates repeated task generations while preserving useful task status", () => {
    const firstRun = buildStructuredAiItems(context, {
      data: {
        tasks: {
          my_work: [{ task: "Doplnit export", status: "done" }]
        }
      }
    });
    const secondRun = buildStructuredAiItems({ ...context, aiOutputId: "out-2" }, {
      data: {
        tasks: {
          my_work: [{ task: "Doplnit export", status: "new" }]
        }
      }
    });

    const result = dedupeStructuredAiItems({
      chapters: [],
      decisions: [],
      risks: [],
      tasks: [
        { ...firstRun.tasks[0]!, created_at: "2026-05-24T08:00:00.000Z" },
        { ...secondRun.tasks[0]!, created_at: "2026-05-24T09:00:00.000Z" }
      ]
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      ai_output_id: "out-1",
      status: "done",
      title: "Doplnit export"
    });
  });
});
