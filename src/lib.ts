import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321",
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? "public-anon-key",
);

export type Media = { type: "video" | "image"; url: string; thumb?: string | null };

export type Ad = {
  id: string;
  platform: string;
  ad_archive_id: string;
  page_name: string | null;
  body: string | null;
  title: string | null;
  cta: string | null;
  link_url: string | null;
  format: "video" | "image" | "carousel";
  media: Media[];
  countries: string[];
  publisher_platforms: string[];
  start_date: string | null;
  end_date: string | null;
  is_active: boolean | null;
  snapshot_url: string;
  angle: string | null;
  hook: string | null;
  hook_type: string | null;
  why_it_works: string | null;
  adaptation: string | null;
  ai_score: number | null;
  ai_summary: string | null;
  score: number | null;
  variations: number | null;
  days_active: number;
  first_seen: string;
};

export type Client = {
  id: string;
  name: string;
  rubro: string | null;
  drive_folder_url: string | null;
  website: string | null;
  instagram: string | null;
  usp: string | null;
  target: string | null;
  messages: string[];
  tone: string | null;
  avoid: string | null;
  competitors: string[];
  keywords: string[];
  notes: string | null;
};

export const HOOK_TYPES = [
  "Pregunta",
  "Dolor / problema",
  "Demostración de producto",
  "Detalle / calidad",
  "Testimonio / UGC",
  "Antes y después / comparación",
  "Oferta / precio",
  "Lifestyle / aspiracional",
  "Proceso / fabricación",
  "Novedad / lanzamiento",
  "Autoridad / datos",
  "Otro",
];

export type Search = {
  id: string;
  client_id: string | null;
  rubro: string;
  keywords: string[];
  countries: string[];
  media_type: string;
  max_per_query: number;
  status: string;
  progress: string | null;
  error: string | null;
  total_found: number;
  recurring: boolean;
  created_at: string;
};

export type Pedido = {
  id: string;
  slug: string;
  client_id: string | null;
  title: string;
  objective: string | null;
  notes: string | null;
  artifact_url: string | null;
  drive_url: string | null;
  created_at: string;
};

export type PedidoItem = {
  id?: string;
  pedido_id?: string;
  ad_id: string | null;
  position: number;
  piece_name: string | null;
  format: string | null;
  angle: string | null;
  script: string | null;
  notes: string | null;
};

export const COUNTRIES: [string, string][] = [
  ["AR", "Argentina"],
  ["UY", "Uruguay"],
  ["CL", "Chile"],
  ["PY", "Paraguay"],
  ["BO", "Bolivia"],
  ["PE", "Perú"],
  ["CO", "Colombia"],
  ["EC", "Ecuador"],
  ["MX", "México"],
  ["ES", "España"],
  ["US", "Estados Unidos"],
  ["BR", "Brasil"],
];

export const PIECE_FORMATS = ["Reel 9:16", "Story 9:16", "Feed 4:5", "Feed 1:1", "Carrusel", "Estático 4:5"];

export function formatLabel(f: string) {
  return f === "video" ? "Video" : f === "carousel" ? "Carrusel" : "Imagen";
}
