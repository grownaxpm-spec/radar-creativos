#!/usr/bin/env bash
# Copia el código compartido del buscador a la Edge Function de Supabase.
set -e
cd "$(dirname "$0")"
cp scraper/normalize.ts scraper/apify.ts scraper/classify.ts supabase/functions/search-worker/
