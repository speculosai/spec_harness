/**
 * The workspace's icons, inline.
 *
 * An icon package would be a runtime dependency for eleven glyphs, and a font or a
 * sprite sheet would be a network request the host's CSP has to allow. These are
 * `currentColor` SVGs, so they take their colour from the surrounding token.
 */

import type { ReactElement } from 'react';

/** Props shared by every icon: size in pixels, defaulting to 14. */
export interface IconProps {
  /** Width and height in pixels. Defaults to 14. */
  size?: number;
  /** Extra class names, e.g. the spinner animation. */
  className?: string;
}

function svg(size: number, className: string | undefined, children: ReactElement): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A spinning arc. Pair with `harness-spin` for the animation. */
export function SpinnerIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(size, `harness-spin${className ? ` ${className}` : ''}`, <path d="M21 12a9 9 0 1 1-6.219-8.56" />);
}

/** A check mark: a finished step. */
export function CheckIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(size, className, <path d="M20 6 9 17l-5-5" />);
}

/** A cross: dismiss, or remove an attachment. */
export function CloseIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(size, className, <path d="M18 6 6 18M6 6l12 12" />);
}

/** A paper plane: send. */
export function SendIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(size, className, <path d="m22 2-7 20-4-9-9-4Zm0 0L11 13" />);
}

/** A filled square: stop the current turn. */
export function StopIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** A paperclip: attach an image or a CSV. */
export function AttachIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(
    size,
    className,
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  );
}

/** A spreadsheet: a CSV attachment. */
export function SheetIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(
    size,
    className,
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h6M8 13h8M8 17h8" />
    </>,
  );
}

/** A document: a file in the tree. */
export function FileIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(
    size,
    className,
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h6" />
    </>,
  );
}

/** A folder: a directory in the tree. */
export function FolderIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(
    size,
    className,
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />,
  );
}

/** A chevron: an expandable directory. Rotated by CSS when open. */
export function ChevronIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(size, className, <path d="m9 18 6-6-6-6" />);
}

/** A circular arrow: rebuild, or restore a version. */
export function RestoreIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(
    size,
    className,
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>,
  );
}

/** A wand: ask the agent to repair the preview. */
export function RepairIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(
    size,
    className,
    <>
      <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h0M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" />
    </>,
  );
}

/** A side panel: toggle the file explorer. */
export function PanelIcon({ size = 14, className }: IconProps): ReactElement {
  return svg(
    size,
    className,
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </>,
  );
}

export function DiffIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3v18M5 9h14M5 15h14" />
    </svg>
  );
}

/** The default mark, used when a host supplies no `brand.Logo`. */
export function HarnessMark({ size = 16, className }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" opacity="0.14" />
      <path d="M8 15.5 12 6l4 9.5M9.6 12.6h4.8" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}
