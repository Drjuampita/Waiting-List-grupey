import { defaultDeps } from '../lib/deps';
import { createPreRegisterHandler } from '../lib/preRegister';

// Firma web estándar de Vercel (Request → Response). Todos los métodos llegan al mismo
// handler para que cualquiera distinto de POST reciba 405 en JSON con `Allow: POST`.
const handler = createPreRegisterHandler(defaultDeps());

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
