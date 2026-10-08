export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

const REFRESH_PATH = '/api/auth/refresh';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSessionLost: () => void = () => undefined;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const setSessionLostHandler = (handler: () => void): void => {
  onSessionLost = handler;
};

async function send(path: string, { method = 'GET', body, auth = true }: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'jbf-web' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data as { message?: unknown; fieldErrors?: Record<string, string[]> };
    throw new ApiError(
      response.status,
      typeof payload.message === 'string' ? payload.message : 'Something went wrong. Please try again.',
      payload.fieldErrors ?? {},
    );
  }
  return data as T;
}

export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await send(REFRESH_PATH, { method: 'POST', body: { client: 'web' }, auth: false });
      if (!response.ok) return false;
      const data = await parse<{ accessToken: string }>(response);
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const auth = options.auth ?? true;
  let response = await send(path, options);
  if (response.status === 401 && auth && path !== REFRESH_PATH) {
    if (await refreshSession()) {
      response = await send(path, options);
    } else {
      accessToken = null;
      onSessionLost();
    }
  }
  return parse<T>(response);
}
