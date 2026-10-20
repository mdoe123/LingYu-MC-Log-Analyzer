import type { ReactNode } from 'react'

export type IconName =
  | 'upload'
  | 'sliders'
  | 'check'
  | 'chevron'
  | 'copy'
  | 'download'
  | 'refresh'
  | 'close'
  | 'alert'
  | 'file'
  | 'folder'
  | 'zip'
  | 'spark'
  | 'play'
  | 'stop'

const PATHS: Record<IconName, ReactNode> = {
  upload: (
    <>
      <path d="M8 3.2v6.6" />
      <path d="M5.4 7.1L8 9.8l2.6-2.7" />
      <path d="M3.2 11.5v1.3c0 .55.45 1 1 1h7.6c.55 0 1-.45 1-1v-1.3" />
    </>
  ),
  sliders: (
    <>
      <path d="M2.4 4.5h5.6M11.6 4.5h2M2.4 8h2.6M8.2 8h5.4M2.4 11.5h5.6M11.6 11.5h2" />
      <circle cx="9.8" cy="4.5" r="1.4" />
      <circle cx="6.4" cy="8" r="1.4" />
      <circle cx="9.8" cy="11.5" r="1.4" />
    </>
  ),
  check: <path d="M3.4 8.3l3.1 3.1 6.1-6.6" />,
  chevron: <path d="M4.2 6.2L8 10l3.8-3.8" />,
  copy: (
    <>
      <rect x="5.6" y="5.6" width="7.8" height="7.8" rx="1.6" />
      <path d="M10.4 5.6V4.1c0-.9-.7-1.6-1.6-1.6H4.1c-.9 0-1.6.7-1.6 1.6v4.7c0 .9.7 1.6 1.6 1.6h1.5" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.8v7.3" />
      <path d="M5.2 7.4L8 10.2l2.8-2.8" />
      <path d="M2.9 12.6h10.2" />
    </>
  ),
  refresh: (
    <>
      <path d="M13.1 8a5.1 5.1 0 1 1-1.7-3.8" />
      <path d="M13.3 2.7v3.2H10.1" />
    </>
  ),
  close: <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />,
  alert: (
    <>
      <path d="M8 2.7l5.9 10.1c.2.4-.1.9-.5.9H2.6c-.4 0-.7-.5-.5-.9L8 2.7z" />
      <path d="M8 6.4v3.1M8 11.4v.1" />
    </>
  ),
  file: (
    <>
      <path d="M9.2 2.3H4.7c-.8 0-1.4.6-1.4 1.4v8.6c0 .8.6 1.4 1.4 1.4h6.6c.8 0 1.4-.6 1.4-1.4V5.4L9.2 2.3z" />
      <path d="M9.1 2.3v3.2h3.6" />
    </>
  ),
  folder: (
    <>
      <path d="M2.4 5.3c0-.7.55-1.25 1.25-1.25h2.1l1.2 1.35h5.4c.7 0 1.25.55 1.25 1.25v5.2c0 .7-.55 1.25-1.25 1.25H3.65c-.7 0-1.25-.55-1.25-1.25V5.3z" />
      <path d="M2.4 6.6h11.2" />
    </>
  ),
  zip: (
    <>
      <path d="M9.2 2.3H4.7c-.8 0-1.4.6-1.4 1.4v8.6c0 .8.6 1.4 1.4 1.4h6.6c.8 0 1.4-.6 1.4-1.4V5.4L9.2 2.3z" />
      <path d="M6.4 5.6h1.2M6.4 7.5h1.2M6.4 9.4h1.2" />
    </>
  ),
  spark: (
    <path d="M8 2.4l1.35 3.45L12.8 7.2l-3.45 1.35L8 12l-1.35-3.45L3.2 7.2l3.45-1.35L8 2.4z" />
  ),
  play: <path d="M5.6 3.5l7.2 4.5-7.2 4.5z" />,
  stop: <rect x="4.8" y="4.8" width="6.4" height="6.4" rx="1.2" />
}

export function Icon({
  name,
  size = 14,
  className,
  style
}: {
  name: IconName
  size?: number
  className?: string
  style?: React.CSSProperties
}): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}

export function BrandMark(): ReactNode {
  return (
    <svg className="brand-mark" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1" y="1" width="20" height="20" rx="6" fill="#16241a" stroke="#33543a" />
      <path d="M6 8.6L11 6.1l5 2.5-5 2.5z" fill="#79c97f" />
      <path d="M6 8.6l5 2.5v4L6 12.6z" fill="#3c7a46" />
      <path d="M16 8.6l-5 2.5v4l5-2.5z" fill="#2c5c35" />
    </svg>
  )
}
