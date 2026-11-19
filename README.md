# Radar de Creativos

Buscador de referencias de anuncios (Biblioteca de Anuncios de Meta) para armar pedidos de piezas.

**Flujo:** Buscar (rubro + palabras clave + países) → la Biblioteca se llena con videos e imágenes ordenados por días activo → guardás en favoritos o en la biblioteca de cada cliente → elegís 10 → "Crear pedido de piezas" → "Copiar para Claude" → Claude escribe los guiones, publica el artefacto y lo guarda en el Drive del cliente.

## Cómo está armado (todo en planes gratis)

| Parte | Servicio | Dónde está en el código |
|---|---|---|
| Aplicación web | Vercel (o Cloudflare Pages) | `src/`, `vercel.json` |
| Botón "Empezar búsqueda" | Vercel Function (o Cloudflare Pages Function) | `api/start-search.ts`, `server/startSearch.ts` |
| Base de datos, login, favoritos | Supabase | `supabase/schema.sql` |
| Búsqueda en la Biblioteca de Meta | Apify, corrido desde GitHub Actions | `scraper/`, `.github/workflows/scrape.yml` |
| Videos e imágenes guardados | Cloudflare R2 (o Supabase Storage si no hay R2) | `scraper/storage.ts` |
| Filtro de ruido y ángulos con IA (opcional) | API de Claude | `scraper/classify.ts` |

## Puesta en marcha (una sola vez, ~30 min)

### 1. Supabase
1. Crear proyecto en supabase.com (plan Free).
2. **SQL Editor** → pegar `supabase/schema.sql` → Run.
3. Agregar a las personas del equipo (en el SQL Editor):
   ```sql
   insert into team_members (email) values ('persona1@agencia.com'), ('persona2@agencia.com');
   ```
4. **Authentication → URL Configuration**: en *Site URL* poner la URL de Cloudflare Pages (paso 3).
5. Anotar de **Project Settings → API**: `Project URL`, `anon public key` y `service_role key` (esta última es secreta).

### 2. Cloudflare R2 (videos) — opcional
Si no cargás los secretos `R2_*`, los videos se guardan en Supabase Storage (1 GB gratis, ≈200 videos; el bucket `media` lo crea el `schema.sql`). Cuando se llene, activás R2 y listo.

1. Cloudflare → **R2** → activar (pide tarjeta, pero los primeros 10 GB son gratis) → *Create bucket* `radar-creativos`.
2. En el bucket: **Settings → Public access → R2.dev subdomain → Allow**. Anotar la URL pública (`https://pub-xxxx.r2.dev`).
3. **R2 → Manage API tokens → Create token** con permiso *Object Read & Write* sobre ese bucket. Anotar `Access Key ID`, `Secret Access Key` y el `Account ID`.

### 3. Vercel (la aplicación)
1. vercel.com → **Add New → Project** → importar este repositorio de GitHub (la configuración se lee de `vercel.json`).
2. **Environment Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GITHUB_REPO` y `GITHUB_TOKEN` (mismos valores que abajo).
3. Deploy. La URL queda tipo `https://radar-creativos.vercel.app`.

### 3 (alternativa). Cloudflare Pages
1. **Workers & Pages → Create → Pages → Connect to Git** → elegir este repositorio.
2. Build command: `npm run build` · Output directory: `dist`.
3. Variables de entorno (Settings → Variables):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (del paso 1)
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (los mismos valores, para la función)
   - `GITHUB_REPO` = `usuario/radar-creativos`
   - `GITHUB_TOKEN` (secreto) = token *fine-grained* de GitHub con acceso solo a este repo y permiso **Actions: Read and write**
4. Deploy. La URL queda tipo `https://radar-creativos.pages.dev`.

### 4. GitHub (el buscador)
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secreto | Valor |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `APIFY_TOKEN` | Apify → Settings → API & Integrations |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | del paso 2 |
| `R2_BUCKET` | `radar-creativos` |
| `R2_PUBLIC_URL` | `https://pub-xxxx.r2.dev` |
| `ANTHROPIC_API_KEY` | *(recomendado)* activa el análisis con IA: descarta ruido, detecta el hook, explica por qué funciona y cómo adaptarlo al cliente (≈ centavos por búsqueda con Haiku) |

Variables opcionales (pestaña *Variables*): `APIFY_ACTOR` (por defecto `apify/facebook-ads-scraper`), `CLAUDE_MODEL` (por defecto `claude-haiku-5-5`, el más barato).

## Uso diario
- **Buscar**: rubro, palabras clave (una por línea), países. Tarda unos minutos. Con "Repetir cada semana" se actualiza sola.
- **Clientes**: cada cliente tiene un perfil (USP, público, mensajes guía, tono, qué no decir, competidores, palabras clave). Al buscar para un cliente, la IA lo usa para filtrar y adaptar.
- **Biblioteca**: ordenada por puntaje de probable ganador (días activo + variaciones del mismo creativo + activo/países/plataformas + calidad creativa según la IA). También se puede ordenar por días activo (cuanto más tiempo una marca sostiene un anuncio, más probable que le funcione). ☆ guarda en *Favoritos generales* o en la biblioteca del cliente elegido arriba.
- **Pedido**: elegí anuncios → *Crear pedido de piezas* → completá formato y notas → *Copiar para Claude* → pegalo en Claude. El link `/p/...` se puede mandar al cliente sin login.

## Costos
Todo gratis salvo Apify por encima de USD 5/mes de uso (≈1.000–3.000 anuncios) y la API de Claude si se activa (≈USD 1–3/mes con Haiku).

## Desarrollo
```bash
npm install
cp .env.example .env   # completar
npm run dev            # app en localhost:5173
npm test               # tests del normalizador
SEARCH_ID=... npm run scrape   # correr una búsqueda a mano (necesita las variables del paso 4)
```
