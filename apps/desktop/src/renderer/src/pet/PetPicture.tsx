// A picture in the Herder's reply, drawn the way Markdown shows an image (ADR 0075): in the text,
// as wide as the reply at most, no frame. The page never loads files itself: main reads the
// picture (only real pictures of a fair size) and hands back a data URL. It is read again each
// time it is drawn, since a task may write a fresh one (a new QR code) at the same path.
// A tap opens it in Preview; right-click copies it (main's menu). When main will not read it,
// its name and path are shown as text, which can be selected and copied.

import { useEffect, useState } from "react";

export function PetPicture({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const read = window.agentherd?.pet?.readImage;
    if (read === undefined) {
      setSrc(null);
      return;
    }
    setSrc(undefined);
    read(path).then(
      (url) => live && setSrc(url ?? null),
      () => live && setSrc(null),
    );
    return () => {
      live = false;
    };
  }, [path]);
  const name = alt === "" ? path.slice(path.lastIndexOf("/") + 1) : alt;
  if (src === null) {
    return (
      <span className="pet-md-picture-missing">
        🖼️ {name}：<code>{path}</code>
      </span>
    );
  }
  if (src === undefined) return <span className="pet-md-picture-wait">图片加载中…</span>;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a tap opens Preview; the path is in its title.
    <img
      className="pet-md-picture"
      src={src}
      alt={name}
      title={`${name}（点一下用预览打开，右键可复制）`}
      draggable={false}
      onClick={() => window.agentherd?.pet?.openFile(path)}
    />
  );
}
