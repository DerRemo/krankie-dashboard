export function RatingHistogram({ counts }: { counts: [number, number, number, number, number] }) {
  const max = Math.max(1, ...counts);
  return (
    <div class="rating-histogram">
      {[5, 4, 3, 2, 1].map((star) => {
        const n = counts[star - 1]!;
        return (
          <div class="histogram-row">
            <span class="histogram-star num">{star}★</span>
            <span class="histogram-bar"><span class="histogram-bar-fill" style={`width:${(n / max) * 100}%`} /></span>
            <span class="histogram-count num">{n}</span>
          </div>
        );
      })}
    </div>
  );
}
