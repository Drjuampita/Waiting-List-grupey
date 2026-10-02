import { defaultDeps } from '../lib/deps';
import { createHealthHandler } from '../lib/health';

const deps = defaultDeps();
const handler = createHealthHandler(deps.db, deps.log);

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
