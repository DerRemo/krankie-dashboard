export function StarRating({ value }: { value: number }) {
  const filled = Math.round(value);
  const stars = Array.from({ length: 5 }, (_, i) => (i < filled ? "★" : "☆")).join("");
  return <span class="star-rating" aria-label={`${value.toFixed(1)} von 5`}>{stars}</span>;
}
