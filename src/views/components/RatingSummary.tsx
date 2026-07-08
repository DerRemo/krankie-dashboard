import { StarRating } from "./StarRating";
import { RatingHistogram } from "./RatingHistogram";
import type { ReviewHistogram } from "../../data/reviews";

export function RatingSummary({ average, count, histogram }: { average: number; count: number; histogram: ReviewHistogram }) {
  return (
    <div class="rating-summary">
      <div class="rating-summary-headline">
        <span class="rating-avg num">{average.toFixed(1)}</span>
        <StarRating value={average} />
        <span class="rating-count">{count} Bewertungen</span>
      </div>
      {histogram.total > 0 && (
        <div class="rating-histogram-block">
          <div class="section-label">Reviews nach Sternen (n={histogram.total})</div>
          <RatingHistogram counts={histogram.counts} />
        </div>
      )}
    </div>
  );
}
