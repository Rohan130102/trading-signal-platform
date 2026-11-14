/**
 * Where the end-to-end stack listens. 3000 and 4000 unless set, so it can run beside a local demo:
 * build the website with API_ORIGIN and NEXT_PUBLIC_WS_URL pointing at E2E_API_PORT, then run the tests.
 */
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4000);
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://localhost:${API_PORT}`;
