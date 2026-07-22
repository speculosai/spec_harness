/**
 * A tiny placeholder logo for the Northwind example.
 *
 * The `brand.Logo` prop is a slot — pass any element. This one is a plain inline
 * SVG so the example has no image assets to ship. Replace it with your own mark.
 */
export function NorthwindLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" role="img" aria-label="Northwind">
      <rect x="1" y="1" width="18" height="18" rx="4" fill="currentColor" opacity="0.12" />
      <path d="M5 14V6l5 5V6m0 8V9l5 5V6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
