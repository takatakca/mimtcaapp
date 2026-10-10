import type { FaqItem } from "@/lib/faq";
import { href, type Lang } from "@/lib/site";

/** Questions as native <details> (no JavaScript, keyboard and screen-reader friendly). */
export function FaqList({ lang, items }: { lang: Lang; items: FaqItem[] }) {
  return (
    <div className="faq">
      {items.map((item) => (
        <details key={item.id} id={`q-${item.id}`}>
          <summary>{item.q}</summary>
          <div className="faq__a">
            <p>{item.a}</p>
            {item.link ? (
              <p className="faq__more">
                <a href={href(lang, item.link.route, item.link.hash)}>{item.link.label}</a>
              </p>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}
