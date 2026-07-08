export function AppIconPlaceholder({ name, size = 42 }: { name: string; size?: number }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <div
      class="app-icon-placeholder"
      title="No app icon on file yet"
      style={`width:${size}px;height:${size}px;`}
    >
      <span style={`font-size:${Math.round(size * 0.36)}px;`}>{initial}</span>
    </div>
  );
}
