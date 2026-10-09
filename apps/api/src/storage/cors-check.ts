export interface CorsResponse {
  allowOrigin: string | null;
  allowMethods: string | null;
  exposeHeaders: string | null;
}

const tokens = (value: string | null): string[] => (value ?? '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);

// Judges the CORS headers the bucket sent back for a browser upload from `origin`. Returns plain-words problems.
export function evaluateCors(response: CorsResponse, origin: string): string[] {
  const problems: string[] = [];
  if (response.allowOrigin !== '*' && response.allowOrigin !== origin) {
    problems.push(`The bucket's browser permissions (CORS) do not allow the web address ${origin} to upload.`);
  }
  if (!tokens(response.allowMethods).includes('put')) {
    problems.push('The bucket does not allow the PUT method from the browser.');
  }
  if (!tokens(response.exposeHeaders).includes('etag')) {
    problems.push('The bucket does not expose the ETag header, so the browser cannot read each piece\'s receipt.');
  }
  return problems;
}
