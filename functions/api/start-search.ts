// Cloudflare Pages Function: POST /api/start-search (alternativa a Vercel)
import { startSearch, type StartEnv } from "../../api/start-search.ts";

export const onRequestPost = ({ request, env }: { request: Request; env: StartEnv }) => startSearch(request, env);
