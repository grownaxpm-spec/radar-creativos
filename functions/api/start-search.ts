// Cloudflare Pages Function: POST /api/start-search (alternativa a Vercel)
import { startSearch, type StartEnv } from "../../server/startSearch.ts";

export const onRequestPost = ({ request, env }: { request: Request; env: StartEnv }) => startSearch(request, env);
