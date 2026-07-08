import { test, expect } from "bun:test";
import { Layout } from "../../src/views/layout";

const navApps = [{ appStoreId: "111", name: "Aurora" }, { appStoreId: "222", name: null }];

test("Layout renders nav and shell, no global check pill", () => {
  const html = String(<Layout title="x" active="overview" navApps={navApps} tdConfigured={true}><p>hi</p></Layout>);
  expect(html).toContain("/style.css");
  expect(html).toContain("/client.js");
  expect(html).toContain('href="/"');
  expect(html).toContain('href="/apps/111"');
  expect(html).toContain("Aurora");
  expect(html).not.toContain('id="check-trigger"');
  expect(html).not.toContain('id="check-status"');
  expect(html).toContain("hi");
});

test("Layout renders one nav link per tracked app, falling back to appStoreId when unnamed", () => {
  const html = String(<Layout title="x" active={null} navApps={navApps} tdConfigured={false}><p>hi</p></Layout>);
  expect(html).toContain('href="/apps/111"');
  expect(html).toContain('href="/apps/222"');
  expect(html).toContain(">222<");
});

test("Layout marks the active app link with aria-current=page", () => {
  const html = String(<Layout title="x" active={null} activeApp="111" navApps={navApps} tdConfigured={false}><p>hi</p></Layout>);
  expect(html).toContain('href="/apps/111" aria-current="page"');
});

test("Layout drops the old data-type nav links", () => {
  const html = String(<Layout title="x" active="overview" navApps={navApps} tdConfigured={true}><p>hi</p></Layout>);
  expect(html).not.toContain('href="/movers"');
  expect(html).not.toContain('href="/keywords"');
  expect(html).not.toContain('href="/competitors"');
  expect(html).not.toContain('href="/reviews"');
});

test("Layout hides the TelemetryDeck nav link when TD is not configured", () => {
  const html = String(<Layout title="x" active="overview" navApps={[]} tdConfigured={false}><p>hi</p></Layout>);
  expect(html).not.toContain('href="/td"');
});

test("Layout shows the TelemetryDeck nav link when TD is configured", () => {
  const html = String(<Layout title="x" active="overview" navApps={[]} tdConfigured={true}><p>hi</p></Layout>);
  expect(html).toContain('href="/td"');
});
