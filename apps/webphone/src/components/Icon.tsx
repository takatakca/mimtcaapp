// Small inline icon set (stroke icons, 24×24), so the app ships no icon font.
const PATHS = {
  messages: "M4 5h16v11H8l-4 4z",
  phone:
    "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  voicemail: "M6.5 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm11 0a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zM6.5 15.5h11",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0",
  business: "M3 21V7l9-4 9 4v14M9 21v-6h6v6M7 10h2m6 0h2",
  offers: "M3 7h18v13H3zM8 7V4h8v3",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6",
  dialpad: "M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01M12 22h.01",
  hangup: "M3 14c5-4 13-4 18 0l-2 3-4-1v-2a9 9 0 0 0-6 0v2l-4 1z",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm-6-3a6 6 0 0 0 12 0M12 18v3",
  micOff: "M3 3l18 18M9 9v3a3 3 0 0 0 5 2M15 10V6a3 3 0 0 0-6-.5M6 12a6 6 0 0 0 9.5 4.9M18 12a6 6 0 0 1-.5 2.4M12 18v3",
  pause: "M8 5v14M16 5v14",
  play: "M7 4l13 8-13 8z",
  close: "M6 6l12 12M18 6L6 18",
  back: "M15 5l-7 7 7 7",
  send: "M4 12l16-8-6 16-3-7z",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4L9 7 7 8 5 7l-2 4 2 1v0l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4z",
  plus: "M12 5v14M5 12h14",
  users: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 9a6 6 0 0 1 12 0m1-9a3 3 0 1 0 0-6m2 15a6 6 0 0 0-3-5",
  alert: "M12 4l9 16H3zM12 10v4m0 3h.01",
  backspace: "M9 5h11v14H9l-6-7zM12 9l6 6m0-6l-6 6",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-14v5l3 2",
  sparkle: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
  video: "M3 7h12v10H3zM15 10l6-3v10l-6-3",
  videoOff: "M3 3l18 18M7 7H3v10h12v-2M15 10l6-3v10l-4-2M11 7h4v4",
  screen: "M3 4h18v12H3zM8 20h8M12 16v4M9 10l3-3 3 3M12 7v6",
  hand: "M8 12V5a1.5 1.5 0 0 1 3 0v6m0-7a1.5 1.5 0 0 1 3 0v7m0-5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L8 14",
  chat: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
  wallet: "M3 7h15a3 3 0 0 1 3 3v9H3zM3 7l11-4 2 4M16 14h.01",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2",
  home: "M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5",
  gift: "M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7C11 4 7 3 7 5.5S10 7 12 7zm0 0c1-3 5-4 5-1.5S14 7 12 7z",
  bot: "M6 8h12v10H6zM12 4v4M9.5 13h.01M14.5 13h.01M3 12v3M21 12v3",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
