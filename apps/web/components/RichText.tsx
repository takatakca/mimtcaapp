import type { ReactNode } from "react";

/**
 * Plain text with [label](href) links (lib/guides.ts). Internal paths stay plain links; external ones get
 * rel="noopener". Nothing else is parsed, so copy can never inject HTML.
 */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const [, label, url] = m;
    const external = /^https?:\/\//.test(url!);
    parts.push(
      <a key={m.index} href={url} rel={external ? "noopener" : undefined}>
        {label}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
