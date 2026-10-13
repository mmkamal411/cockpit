/**
 * SchoolGlyph — the graduation-cap glyph shared by every toolbar variant.
 * Size and stroke match each variant's own glyph spec (pass them in), so
 * the School key sits naturally beside Home · Today · Crystal · Progress.
 */
export function SchoolGlyph({
  size = 20,
  strokeWidth = 1.9,
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4 2.5 9 12 14l9.5-5L12 4Z" />
      <path d="M6.5 11v4.2c0 1.6 2.5 2.8 5.5 2.8s5.5-1.2 5.5-2.8V11" />
      <path d="M21.5 9v5" />
    </svg>
  );
}
