import { useState } from "react";
import { formatLabel, type Ad, type Media } from "../lib.ts";

export function MediaView({ media, compact }: { media: Media[]; compact?: boolean }) {
  const [i, setI] = useState(0);
  const m = media[i];
  if (!m) return <div className="media empty">Sin medio</div>;
  return (
    <div className={`media ${compact ? "compact" : ""}`}>
      {m.type === "video" ? (
        <video src={m.url} poster={m.thumb ?? undefined} controls preload="none" playsInline />
      ) : (
        <img src={m.url} alt="" loading="lazy" />
      )}
      {media.length > 1 && (
        <div className="dots">
          {media.map((_, k) => (
            <button key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Medio ${k + 1}`} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdCard({
  ad,
  selected,
  saved,
  onSelect,
  onSave,
}: {
  ad: Ad;
  selected: boolean;
  saved: boolean;
  onSelect: () => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`ad ${selected ? "selected" : ""}`}>
      <MediaView media={ad.media} />
      <div className="ad-body">
        <div className="row between">
          <b className="ellipsis">{ad.page_name ?? "Sin nombre"}</b>
          <span className={`badge ${ad.days_active >= 30 ? "hot" : ""}`} title="Días activo: cuanto más tiempo lo sostiene la marca, más probable que le funcione">
            {ad.days_active} días
          </span>
        </div>
        <div className="chips">
          <span className="chip">{formatLabel(ad.format)}</span>
          {ad.angle && <span className="chip angle">{ad.angle}</span>}
          {ad.countries.map((c) => (
            <span key={c} className="chip light">{c}</span>
          ))}
        </div>
        {ad.hook && <p className="hook">“{ad.hook}”</p>}
        {ad.body && (
          <p className={`copy ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
            {ad.body}
          </p>
        )}
        <div className="row actions">
          <button className={selected ? "" : "ghost"} onClick={onSelect}>
            {selected ? "✓ Elegido" : "Elegir"}
          </button>
          <button className={`ghost icon ${saved ? "on" : ""}`} onClick={onSave} title="Guardar en la biblioteca">
            {saved ? "★" : "☆"}
          </button>
          <a className="ghost-link" href={ad.snapshot_url} target="_blank" rel="noreferrer">
            Ver en Meta ↗
          </a>
        </div>
      </div>
    </article>
  );
}
