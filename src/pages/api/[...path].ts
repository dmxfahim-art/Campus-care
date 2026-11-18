import type { APIRoute } from 'astro';
import { api } from '../../server/api';

export const prerender = false;
const handle: APIRoute = ({ request }) => api.fetch(request);
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
