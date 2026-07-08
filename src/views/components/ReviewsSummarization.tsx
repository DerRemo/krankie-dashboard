export function ReviewsSummarization({ text }: { text: string | null }) {
  if (!text) return <></>;
  return (
    <div class="review-summarization card-soft">
      <div class="section-label">Apple Zusammenfassung</div>
      <p>{text}</p>
    </div>
  );
}
