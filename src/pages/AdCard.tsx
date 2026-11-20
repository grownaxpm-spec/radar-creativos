import { useEffect, useRef, useState } from "react";
import { formatLabel, type Ad, type Media } from "../lib.ts";

export const HOOK_SECONDS = 10;

/**
 * Muestra el video o la imagen. Con `clip`, el video se reproduce solo los primeros 10 segundos (el hook)
 * y vuelve a empezar: se corta en el navegador, el archivo original queda entero.
 */
export function MediaView({ media, compact, clip, large }: { media: Media[]; compact?: boolean; clip?: boolean; large?: boolean }) {
  const [i, setI] = useState(0);
  const ref = useRef<HTMLVideoElement>(null);
  const m = media[i];
  useEffect(() => setI(0), [media]);
  if (!m) return <div className="media empty">Sin medio</div>;
  return (
    <div className={`media ${compact ? "compact" : ""} ${large ? "large" : ""}`}>
      {m.type === "video" ? (
        <video
          ref={ref}
          src={clip ? `${m.url}#t=0,${HOOK_SECONDS}` : m.url}
          poster={m.thumb ?? undefined}
          controls
          preload={clip ? "metadata" : "none"}
          playsInline
          muted={clip}
          onTimeUpdate={(e) => {
            if (clip && e.currentTarget.currentTime >= HOOK_SECONDS) {
              e.currentTarget.currentTime = 0;
              void e.currentTarget.play();
            }
          }}
        />
      ) : (
        <img src={m.url} alt="" loading="lazy" />
      )}
      {clip && m.type === "video" && <span className="clip-badge">Hook · {HOOK_SECONDS} s</span>}
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
  hookMode,
  onSelect,
  onSave,
  onDiscard,
  onOpen,
}: {
  ad: Ad;
  selected: boolean;
  saved: boolean;
  hookMode?: boolean;
  onSelect: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onOpen: () => void;
}) {
  return (
    <article className={`ad ${selected ? "selected" : ""}`}>
      <div className="ad-top">
        <label className="pick" title="Elegir para el pedido o para compartir">
          <input type="checkbox" checked={selected} onChange={onSelect} />
        </label>
        <button className="discard" title="Descartar: no sirve para este cliente" onClick={onDiscard}>
          ✕ Descartar
        </button>
        <MediaView media={ad.media} clip={hookMode} />
      </div>
      <div className="ad-body" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
        <div className="row between">
          <b className="ellipsis">{ad.page_name ?? "Sin nombre"}</b>
          <span className="row" style={{ gap: 4 }}>
            {ad.score != null && (
              <span
                className={`badge ${ad.score >= 70 ? "hot" : ""}`}
                title="Puntaje de probable ganador (0-100): días activo, variaciones del mismo creativo, si sigue activo, países y plataformas, más la calidad creativa según la IA"
              >
                ★ {ad.score}
              </span>
            )}
            <span className="badge" title="Días activo: cuanto más tiempo lo sostiene la marca, más probable que le funcione">
              {ad.days_active} días
            </span>
          </span>
        </div>
        <div className="chips">
          {!hookMode && <span className="chip">{formatLabel(ad.format)}</span>}
          {ad.hook_type && <span className="chip hook">{ad.hook_type}</span>}
          {ad.angle && <span className="chip angle">{ad.angle}</span>}
          {(ad.variations ?? 1) > 1 && <span className="chip light" title="Variaciones del mismo creativo: si lo duplican, lo están escalando">×{ad.variations}</span>}
        </div>
        {ad.hook && <p className="hook"><b>Hook:</b> “{ad.hook}”</p>}
        {!hookMode && ad.body && <p className="copy">{ad.body}</p>}
        <span className="more-link">Ver análisis completo →</span>
      </div>
      <div className="row actions">
        <button className={selected ? "" : "ghost"} onClick={onSelect}>
          {selected ? "✓ Elegido" : "Elegir"}
        </button>
        <button className={`ghost icon ${saved ? "on" : ""}`} onClick={onSave} title="Guardar en favoritos / biblioteca del cliente">
          {saved ? "★" : "☆"}
        </button>
        <a className="ghost-link" href={ad.snapshot_url} target="_blank" rel="noreferrer">
          Meta ↗
        </a>
      </div>
    </article>
  );
}

export function AdModal({
  ad,
  selected,
  onClose,
  onSelect,
  onDiscard,
}: {
  ad: Ad;
  selected: boolean;
  onClose: () => void;
  onSelect: () => void;
  onDiscard: () => void;
}) {
  const [clip, setClip] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const isVideo = ad.media.some((m) => m.type === "video");
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={ad.page_name ?? "Anuncio"}>
        <button className="ghost small close" onClick={onClose}>✕</button>
        <div className="modal-grid">
          <div>
            <MediaView media={ad.media} large clip={clip} />
            {isVideo && (
              <label className="check small" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={clip} onChange={(e) => setClip(e.target.checked)} /> Ver solo el hook ({HOOK_SECONDS} s)
              </label>
            )}
          </div>
          <div className="analysis">
            <div className="row between wrap">
              <h2 style={{ margin: 0 }}>{ad.page_name}</h2>
              <span className="row" style={{ gap: 4 }}>
                {ad.score != null && <span className={`badge ${ad.score >= 70 ? "hot" : ""}`}>★ {ad.score}</span>}
                <span className="badge">{ad.days_active} días activo</span>
              </span>
            </div>
            <div className="chips">
              <span className="chip">{formatLabel(ad.format)}</span>
              {ad.hook_type && <span className="chip hook">{ad.hook_type}</span>}
              {ad.angle && <span className="chip angle">{ad.angle}</span>}
              {(ad.variations ?? 1) > 1 && <span className="chip light">×{ad.variations} variaciones</span>}
              {ad.countries.map((c) => <span key={c} className="chip light">{c}</span>)}
            </div>
            {ad.hook && <Block title="Hook">“{ad.hook}”</Block>}
            {ad.why_it_works && <Block title="Por qué funciona">{ad.why_it_works}</Block>}
            {ad.adaptation && <Block title="Cómo adaptarlo al cliente">{ad.adaptation}</Block>}
            {ad.ai_summary && <Block title="Qué muestra">{ad.ai_summary}</Block>}
            {ad.body && <Block title="Texto del anuncio"><span style={{ whiteSpace: "pre-line" }}>{ad.body}</span></Block>}
            <p className="muted small">
              Activo desde {ad.start_date ?? "—"}{ad.end_date ? ` hasta ${ad.end_date}` : ""}
              {ad.publisher_platforms.length ? ` · ${ad.publisher_platforms.join(", ")}` : ""}
            </p>
            <div className="row wrap">
              <button className={selected ? "" : "ghost"} onClick={onSelect}>{selected ? "✓ Elegido" : "Elegir para el pedido"}</button>
              <button className="ghost danger" onClick={onDiscard}>Descartar</button>
              <a className="ghost-link" href={ad.snapshot_url} target="_blank" rel="noreferrer">Ver en la Biblioteca de Meta ↗</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <div className="block-title">{title}</div>
      <div>{children}</div>
    </div>
  );
}
