import { StarRating } from "./StarRating";
import type { ReviewRow } from "../../asc/types";

export function ReviewCard({ review }: { review: ReviewRow }) {
  return (
    <article class="review-card">
      <div class="review-card-head">
        <StarRating value={review.rating} />
        {review.title && <strong class="review-title">{review.title}</strong>}
      </div>
      {review.body && <p class="review-body">{review.body}</p>}
      <div class="review-meta">
        <span>{review.reviewerNickname ?? "Anonym"}</span>
        <span class="review-territory">{review.territory}</span>
        <span class="num">{review.createdAt.slice(0, 10)}</span>
      </div>
    </article>
  );
}
