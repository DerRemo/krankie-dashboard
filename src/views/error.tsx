import { Layout, type NavApp } from "./layout";
import { Card } from "./components/Card";

export function ErrorView({ reason, navApps = [], tdConfigured }: { reason: string; navApps?: NavApp[]; tdConfigured: boolean }) {
  return (
    <Layout title="Error" active={null} navApps={navApps} tdConfigured={tdConfigured}>
      <Card>
        <h1>Something is off</h1>
        <p>{reason}</p>
        <p class="text-muted">Run <code class="num">bunx krankie info</code> on the host to inspect krankie's state.</p>
      </Card>
    </Layout>
  );
}
