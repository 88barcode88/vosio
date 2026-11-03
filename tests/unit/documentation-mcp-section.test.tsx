// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpDocumentationSection } from "@/components/documentation-mcp-section";

const RESOURCE_URL = "https://example-project.supabase.co/functions/v1/vosio-mcp";
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("McpDocumentationSection", () => {
  it("shows the address, the steps and the connections link when MCP is enabled", async () => {
    await act(async () => root.render(<McpDocumentationSection resourceUrl={RESOURCE_URL} />));

    expect(container.querySelector("#pripojeni-ai-asistenta")).not.toBeNull();
    expect(container.querySelector(".documentation-mcp-address")?.textContent).toBe(RESOURCE_URL);
    expect(container.querySelectorAll("ol.documentation-steps li")).toHaveLength(4);
    expect(container.querySelector("a[href='/mcp/connections']")).not.toBeNull();
    expect(container.textContent).not.toContain("V této instalaci není připojení AI asistentů zapnuté.");
  });

  it("shows only the disabled notice without an address or connections link when MCP is off", async () => {
    await act(async () => root.render(<McpDocumentationSection resourceUrl={null} />));

    expect(container.textContent).toContain("V této instalaci není připojení AI asistentů zapnuté.");
    expect(container.querySelector(".documentation-mcp-address")).toBeNull();
    expect(container.querySelector("ol.documentation-steps")).toBeNull();
    expect(container.querySelector("a[href='/mcp/connections']")).toBeNull();
    expect(container.textContent).not.toContain("supabase.co");
  });

  it("always lists the safety rules", async () => {
    await act(async () => root.render(<McpDocumentationSection resourceUrl={null} />));
    expect(container.textContent).toContain("Samotná adresa nic neodemyká");
    expect(container.textContent).toContain("Žádné klíče ani tokeny nikam nekopírujte");
  });
});
