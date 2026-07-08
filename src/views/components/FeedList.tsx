import { Card } from "./Card";
import { StoreBadge } from "./StoreBadge";
import { StarRating } from "./StarRating";
import { fmtDelta, deltaClass } from "../formatting";
import { groupFeed } from "../../data/feed";
import type { FeedEntry, MoverEntry, AscEntry, ReviewEntry } from "../../data/feed";

const VISIBLE = 15;

export function FeedList({ entries }: { entries: FeedEntry[] }) {
  if (entries.length === 0) {
    return <p class="feed-empty">Keine Bewegung in diesem Fenster.</p>;
  }
  const g = groupFeed(entries);
  return (
    <div class="feed-groups">
      <div class="feed-metrics-row">
        <MetricCard label="Impressionen" entries={g.impressions} />
        <MetricCard label="Downloads" entries={g.downloads} />
        <ReviewCard reviews={g.reviews} />
      </div>
      <section>
        <h3 class="feed-group-label">Keywords</h3>
        {g.keywords.length === 0 ? (
          <p class="feed-metric-empty">Keine Keyword-Bewegung.</p>
        ) : (
          <div class="feed-keyword-cols">
            <KeywordColumn title="Aufsteiger" dir="up" movers={g.keywords.filter((m) => m.delta > 0)} />
            <KeywordColumn title="Absteiger" dir="down" movers={g.keywords.filter((m) => m.delta < 0)} />
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, entries }: { label: string; entries: AscEntry[] }) {
  return (
    <Card>
      <h3 class="feed-group-label">{label}</h3>
      {entries.length === 0 ? (
        <p class="feed-metric-empty">—</p>
      ) : (
        <ul class="feed-metric-list">
          {entries.map((e) => (
            <li class="feed-metric-item">
              <span class={`feed-icon ${e.deltaPct >= 0 ? "up" : "down"}`}>{e.deltaPct >= 0 ? "↗" : "↘"}</span>
              <span class={`num feed-metric-delta ${deltaClass(e.deltaPct)}`}>{fmtDelta(e.deltaPct)}</span>
              <span class="feed-metric-app">{e.appName ?? e.appStoreId}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReviewCard({ reviews }: { reviews: ReviewEntry[] }) {
  return (
    <Card>
      <h3 class="feed-group-label">Reviews</h3>
      {reviews.length === 0 ? (
        <p class="feed-metric-empty">—</p>
      ) : (
        <ul class="feed-metric-list">
          {reviews.map((r) => (
            <li class="feed-metric-item">
              <StarRating value={r.rating} />
              <a class="feed-metric-app" href={`/apps/${r.appStoreId}`}>{r.appName ?? r.appStoreId}</a>
              <span class="num feed-metric-date">{r.createdAt.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function KeywordColumn({ title, dir, movers }: { title: string; dir: "up" | "down"; movers: MoverEntry[] }) {
  const head = movers.slice(0, VISIBLE);
  const tail = movers.slice(VISIBLE);
  return (
    <section class="feed-kw-col">
      <div class="feed-kw-col-head" data-dir={dir}>
        <h4>{title}</h4>
        <span class="num feed-kw-col-count">{movers.length}</span>
      </div>
      {movers.length === 0 ? (
        <p class="feed-metric-empty">{dir === "up" ? "Keine Aufsteiger." : "Keine Absteiger."}</p>
      ) : (
        <Card>
          <ul class="feed-list">
            {head.map((m) => <KeywordItem mover={m} />)}
          </ul>
          {tail.length > 0 && (
            <details class="feed-more">
              <summary>{tail.length} weitere anzeigen</summary>
              <ul class="feed-list">
                {tail.map((m) => <KeywordItem mover={m} />)}
              </ul>
            </details>
          )}
        </Card>
      )}
    </section>
  );
}

function KeywordItem({ mover }: { mover: MoverEntry }) {
  const dir = mover.delta > 0 ? "up" : "down";
  return (
    <li class="feed-item" data-kind="mover">
      <span class={`feed-icon num ${dir}`}>{mover.delta > 0 ? "▲" : "▼"}</span>
      <span class="feed-body">
        <a href={`/keywords/${mover.keywordId}`} class="feed-title">{mover.keyword}</a>
        <span class="num feed-rank">#{mover.previousRank} → <strong>#{mover.currentRank}</strong></span>
      </span>
      <span class="feed-meta">{mover.appName ?? mover.appStoreId} · <StoreBadge store={mover.store} /></span>
    </li>
  );
}
