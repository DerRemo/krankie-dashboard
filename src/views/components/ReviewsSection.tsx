import { RatingSummary } from "./RatingSummary";
import { ReviewsSummarization } from "./ReviewsSummarization";
import { ReviewCard } from "./ReviewCard";
import type { RatingSummary as RatingSummaryData, ReviewHistogram } from "../../data/reviews";
import type { ReviewRow } from "../../asc/types";

export interface ReviewsSectionProps {
  summary: RatingSummaryData | null;
  histogram: ReviewHistogram;
  summarization: string | null;
  reviews: ReviewRow[];
}

export function ReviewsSection({ summary, histogram, summarization, reviews }: ReviewsSectionProps) {
  return (
    <>
      <h2 class="section-label">Reviews</h2>
      {summary ? (
        <div class="card">
          <RatingSummary average={summary.average} count={summary.count} histogram={histogram} />
        </div>
      ) : (
        <p class="empty-block">Noch keine Rating-Daten für diese App.</p>
      )}
      <ReviewsSummarization text={summarization} />
      {reviews.length > 0 && (
        <div class="review-list">
          {reviews.map((r) => <ReviewCard review={r} />)}
        </div>
      )}
    </>
  );
}
