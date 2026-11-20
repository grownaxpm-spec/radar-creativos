import { useEffect, useRef, useState } from "react";
import { formatLabel, supabase, type Ad, type Media, type VideoAnalysis } from "../lib.ts";

export const HOOK_SECONDS = 5;

/**
 * Muestra el video o la imagen, con flechas para pasar las fotos de los carruseles.
 * Con `clip`, el video se reproduce solo los primeros 5 segundos (el hook) y vuelve a empezar:
 * se corta en el navegador, el archivo original queda entero.
 * Con `onOpen` (en las tarjetas) el video no tiene controles: un clic lo abre en grande con el análisis.
 */
/**
 * Reproductor de hook: solo existen los primeros 5 segundos. Barra propia de 0 a 5 s, sin poder adelantar,
 * y vuelve a empezar solo. En las tarjetas va sin controles y sin sonido; en grande, con play/pausa y sonido.
 */
export function HookVideo({ src, poster, controls }: { src: string; poster?: string; controls?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(!controls);
  useEffect(() => {
    // Revisa seguido para cortar justo en el segundo 5 (timeupdate solo avisa 4 veces por segundo)
    const id = setInterval(() => {
      const v = ref.current;
      if (!v) return;
      if (v.currentTime >= HOOK_SECONDS || v.ended) {
        v.currentTime = 0;
        if (playing) void v.play().catch(() => {});
      }
      setT(Math.min(v.currentTime, HOOK_SECONDS));
    }, 100);
    return () => clearInterval(id);
  }, [playing]);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };
  return (
    <>
      <video
        ref={ref}
        src={`${src}#t=0,${HOOK_SECONDS}`}
        poster={poster}
        preload="metadata"
        playsInline
        autoPlay
        muted={muted}
        onClick={controls ? toggle : undefined}
        onPause={(e) => {
          // El fragmento #t=0,5 pausa al llegar al 5: lo hacemos volver a empezar
          if (playing && e.currentTarget.currentTime >= HOOK_SECONDS - 0.15) {
            e.currentTarget.currentTime = 0;
            void e.currentTarget.play().catch(() => {});
          }
        }}
      />
      {controls && (
        <div className="hook-bar" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={toggle} aria-label={playing ? "Pausa" : "Reproducir"}>{playing ? "❚❚" : "▶"}</button>
          <div className="hook-track"><div style={{ width: `${(t / HOOK_SECONDS) * 100}%` }} /></div>
          <span className="hook-time">0:0{Math.floor(t)} / 0:0{HOOK_SECONDS}</span>
          <button type="button" onClick={() => setMuted(!muted)} aria-label={muted ? "Activar sonido" : "Silenciar"}>{muted ? "🔇" : "🔊"}</button>
        </div>
      )}
    </>
  );
}

export function MediaView({
  media,
  compact,
  clip,
  large,
  onOpen,
  link,
}: {
  media: Media[];
  compact?: boolean;
  clip?: boolean;
  large?: boolean;
  onOpen?: () => void;
  /** Link para ver el anuncio en Meta cuando no hay archivo para mostrar */
  link?: string;
}) {
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setI(0);
    setBroken(false);
  }, [media]);
  const m = media[i];
  if (!m || broken)
    return (
      <div className={`media empty ${compact ? "compact" : ""} ${large ? "large" : ""}`} onClick={onOpen}>
        <div className="no-media">
          <span>Meta no permite descargar este archivo</span>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              Verlo en Meta ↗
            </a>
          )}
        </div>
      </div>
    );
  const preview = !!onOpen;
  const go = (d: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setI((i + d + media.length) % media.length);
  };
  return (
    <div
      className={`media ${compact ? "compact" : ""} ${large ? "large" : ""} ${preview ? "clickable" : ""}`}
      onClick={onOpen}
      title={preview ? "Ver en grande con el análisis" : undefined}
    >
      {m.type === "video" && clip ? (
        <HookVideo key={m.url} src={m.url} poster={m.thumb ?? undefined} controls={!preview} />
      ) : m.type === "video" ? (
        <video
          key={m.url}
          src={m.url}
          poster={m.thumb ?? undefined}
          controls={!preview}
          preload="metadata"
          playsInline
          muted={preview}
          autoPlay={!!large}
        />
      ) : (
        <img src={m.url} alt="" loading="lazy" onError={() => setBroken(true)} />
      )}
      {preview && m.type === "video" && !clip && <span className="play-badge" aria-hidden>▶</span>}
      {clip && m.type === "video" && <span className="clip-badge">Hook · {HOOK_SECONDS} s</span>}
      {media.length > 1 && (
        <>
          <button type="button" className="car-nav prev" onClick={go(-1)} aria-label="Anterior">‹</button>
          <button type="button" className="car-nav next" onClick={go(1)} aria-label="Siguiente">›</button>
          <span className="car-count">{i + 1}/{media.length}</span>
        </>
      )}
    </div>
  );
}

export default function AdCard({
  ad,
  selected,
  hookSelected,
  saved,
  used,
  hookMode,
  onSelect,
  onSelectHook,
  onSave,
  onDiscard,
  onOpen,
}: {
  ad: Ad;
  selected: boolean;
  hookSelected: boolean;
  saved: boolean;
  used?: boolean;
  hookMode?: boolean;
  onSelect: () => void;
  onSelectHook: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onOpen: () => void;
}) {
  const isVideo = ad.media.some((m) => m.type === "video");
  return (
    <article className={`ad ${selected ? "selected" : ""} ${hookSelected ? "hook-selected" : ""}`}>
      <div className="ad-top">
        <div className="picks">
          <label className="pick" title="Usarlo como referencia de una pieza del pedido">
            <input type="checkbox" checked={selected} onChange={onSelect} /> Ref
          </label>
          {isVideo && (
            <label className="pick" title="Sumar su hook (primeros 5 s) a los hooks sugeridos del pedido">
              <input type="checkbox" checked={hookSelected} onChange={onSelectHook} /> Hook
            </label>
          )}
        </div>
        <button className="discard" title="Descartar: no sirve para este cliente" onClick={onDiscard}>
          ✕ Descartar
        </button>
        <MediaView media={ad.media} clip={hookMode} onOpen={onOpen} link={ad.snapshot_url} />
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
          {used && <span className="chip used">Ya usado en un pedido</span>}
          {!hookMode && <span className="chip">{formatLabel(ad.format)}</span>}
          {ad.direct_sale && <span className="chip sale">Venta directa</span>}
          {ad.hook_type && <span className="chip hook">{ad.hook_type}</span>}
          {ad.angle && <span className="chip angle">{ad.angle}</span>}
          {ad.is_active === false && <span className="chip light" title="La marca lo apagó, pero queda guardado en la biblioteca">Inactivo</span>}
          {(ad.variations ?? 1) > 1 && <span className="chip light" title="Variaciones del mismo creativo: si lo duplican, lo están escalando">×{ad.variations}</span>}
        </div>
        {ad.hook && <p className="hook"><b>Hook:</b> “{ad.hook}”</p>}
        {!hookMode && ad.body && <p className="copy">{ad.body}</p>}
      </div>
      <div className="row actions wrap">
        <button className={selected ? "small" : "ghost small"} onClick={onSelect}>
          {selected ? "✓ Referencia" : "Referencia"}
        </button>
        {isVideo && (
          <button className={hookSelected ? "small" : "ghost small"} onClick={onSelectHook}>
            {hookSelected ? "✓ Hook" : "Hook"}
          </button>
        )}
        <button className={`ghost icon small ${saved ? "on" : ""}`} onClick={onSave} title="Guardar en favoritos / biblioteca del cliente">
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
  hookSelected,
  onClose,
  onSelect,
  onSelectHook,
  onDiscard,
  hookMode,
  onPrev,
  onNext,
  position,
}: {
  ad: Ad;
  selected: boolean;
  hookSelected: boolean;
  onClose: () => void;
  onSelect: () => void;
  onSelectHook: () => void;
  onDiscard: () => void;
  /** En la vista de hooks el video se abre mostrando solo los primeros 5 s */
  hookMode?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  /** "3 de 40" */
  position?: string;
}) {
  const [clip, setClip] = useState(!!hookMode);
  useEffect(() => setClip(!!hookMode), [ad.id, hookMode]);
  useEffect(() => {
    // Las flechas del teclado pasan al anuncio anterior o siguiente (también con el video en foco)
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !(
          (e.target instanceof HTMLInputElement && !["checkbox", "radio"].includes(e.target.type)) ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        )) {
        const go = e.key === "ArrowRight" ? onNext : onPrev;
        if (!go) return;
        e.preventDefault();
        e.stopPropagation();
        go();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose, onPrev, onNext]);
  const isVideo = ad.media.some((m) => m.type === "video");
  return (
    <div className="modal-bg" onClick={onClose}>
      {onPrev && (
        <button className="modal-nav prev" onClick={(e) => { e.stopPropagation(); onPrev(); }} aria-label="Anuncio anterior" title="Anterior (←)">‹</button>
      )}
      {onNext && (
        <button className="modal-nav next" onClick={(e) => { e.stopPropagation(); onNext(); }} aria-label="Anuncio siguiente" title="Siguiente (→)">›</button>
      )}
      <div className="modal" key={ad.id} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={ad.page_name ?? "Anuncio"}>
        <button className="ghost small close" onClick={onClose}>✕</button>
        {position && <span className="modal-pos">{position} · usá ← → para pasar</span>}
        <div className="modal-grid">
          <div className="modal-media">
            <div className="picks modal-picks">
              <label className="pick" title="Usarlo como referencia de una pieza del pedido">
                <input type="checkbox" checked={selected} onChange={onSelect} /> Ref
              </label>
              {isVideo && (
                <label className="pick" title="Sumar su hook (primeros 5 s) a los hooks sugeridos del pedido">
                  <input type="checkbox" checked={hookSelected} onChange={onSelectHook} /> Hook
                </label>
              )}
            </div>
            <MediaView media={ad.media} large clip={clip} link={ad.snapshot_url} />
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
            <div className="row wrap modal-actions">
              <button className={selected ? "small" : "ghost small"} onClick={onSelect}>{selected ? "✓ Referencia" : "Usar como referencia"}</button>
              {isVideo && (
                <button className={hookSelected ? "small" : "ghost small"} onClick={onSelectHook}>{hookSelected ? "✓ Hook sugerido" : "Sumar a hooks"}</button>
              )}
              <button className="ghost danger small" onClick={onDiscard} title="Lo descarta y pasa al siguiente">✕ Descartar</button>
            </div>
            {ad.hook && <Block title="Hook">“{ad.hook}”</Block>}
            {ad.why_it_works && <Block title="Por qué funciona">{ad.why_it_works}</Block>}
            {ad.adaptation && <Block title="Cómo adaptarlo al cliente">{ad.adaptation}</Block>}
            {ad.ai_summary && <Block title="Qué muestra">{ad.ai_summary}</Block>}
            {isVideo && <VideoBlock ad={ad} />}
            {ad.body && <Block title="Texto del anuncio"><span style={{ whiteSpace: "pre-line" }}>{ad.body}</span></Block>}
            <p className="muted small">
              Activo desde {ad.start_date ?? "—"}{ad.end_date ? ` hasta ${ad.end_date}` : ""}
              {ad.publisher_platforms.length ? ` · ${ad.publisher_platforms.join(", ")}` : ""}
            </p>
            <a className="ghost-link small" href={ad.snapshot_url} target="_blank" rel="noreferrer">Ver en la Biblioteca de Meta ↗</a>
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

const fmtSec = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}`;

/** Análisis del video completo: transcripción, texto en pantalla y escena por escena. */
function VideoBlock({ ad }: { ad: Ad }) {
  const [status, setStatus] = useState(ad.video_status ?? null);
  const [v, setV] = useState<VideoAnalysis | null>(ad.video_analysis ?? null);
  const [error, setError] = useState(ad.video_error ?? null);

  // Mientras se procesa, consulta cada 5 segundos
  useEffect(() => {
    if (status !== "processing" && status !== "pending") return;
    const t = setInterval(async () => {
      const { data } = await supabase.from("ads").select("video_status, video_analysis, video_error").eq("id", ad.id).single();
      if (!data) return;
      setStatus(data.video_status);
      setV(data.video_analysis);
      setError(data.video_error);
    }, 5000);
    return () => clearInterval(t);
  }, [status, ad.id]);

  async function run() {
    setStatus("processing");
    setError(null);
    const { error } = await supabase.functions.invoke("search-worker", { body: { action: "analyze_video", ad_id: ad.id } });
    if (error) {
      setStatus("error");
      setError(error.message);
    }
  }

  if (!v)
    return (
      <div className="block video-block">
        <div className="block-title">Lo que pasa en el video</div>
        {status === "processing" || status === "pending" ? (
          <div>
            <div className="progress-bar indeterminate"><div /></div>
            <span className="muted small">La IA está mirando el video completo (imagen y audio)… tarda menos de un minuto.</span>
          </div>
        ) : (
          <div className="row wrap">
            <span className="muted small grow">
              {error ? `No se pudo analizar: ${error}` : "Transcripción, textos en pantalla y escena por escena."}
            </span>
            <button className="small" onClick={run}>{error ? "Reintentar" : "Analizar video"}</button>
          </div>
        )}
      </div>
    );

  return (
    <div className="block video-block">
      <div className="block-title">Lo que pasa en el video · {fmtSec(v.duracion_seg)} · {v.tipo_creativo}</div>
      <p style={{ margin: "0 0 8px" }}>
        <b>Primeros 3 segundos:</b> {v.hook_visual}
        {v.hook_audio && <> — <i>“{v.hook_audio}”</i></>}
      </p>
      <ol className="scenes">
        {v.escenas.map((e, i) => (
          <li key={i}>
            <span className="t">{fmtSec(e.desde_seg)}–{fmtSec(e.hasta_seg)}</span>
            <span>{e.descripcion}</span>
          </li>
        ))}
      </ol>
      <p className="small" style={{ margin: "8px 0 0" }}>
        <b>Quién habla:</b> {v.quien_habla} · <b>Ritmo:</b> {v.ritmo} · <b>Audio:</b> {v.audio} · <b>Cierre:</b> {v.cta}
      </p>
      {v.como_replicarlo && <p className="small" style={{ margin: "8px 0 0" }}><b>Cómo replicarlo:</b> {v.como_replicarlo}</p>}
      {v.transcripcion && (
        <details className="small" style={{ marginTop: 8 }}>
          <summary>Transcripción completa</summary>
          <p style={{ whiteSpace: "pre-line", margin: "6px 0 0" }}>{v.transcripcion}</p>
        </details>
      )}
      {v.texto_en_pantalla.length > 0 && (
        <details className="small" style={{ marginTop: 6 }}>
          <summary>Textos en pantalla</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{v.texto_en_pantalla.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
