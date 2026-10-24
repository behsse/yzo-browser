import { useState } from "react";
import { displayHost } from "../lib/url";

/**
 * Shows a page favicon, falling back to the host's first letter when the page has none or the image
 * fails to load.
 * @param props.src Favicon URL reported by the page.
 * @param props.url Page URL, used for the fallback letter.
 * @param props.size Pixel size (default 16).
 * @returns Image or letter badge.
 */
export function Favicon({ src, url, size = 16 }: { src: string | null; url: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src && /^https?:|^data:image\//.test(src)) {
    return <img className="favicon" src={src} width={size} height={size} alt="" onError={() => setFailed(src)} />;
  }
  const letter = displayHost(url).charAt(0).toUpperCase() || "•";
  return (
    <span className="favicon favicon-letter" style={{ width: size, height: size, fontSize: size * 0.62 }} aria-hidden="true">
      {letter}
    </span>
  );
}
