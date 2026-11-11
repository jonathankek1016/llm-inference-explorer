// Sanitize errors using the credentials/payload belonging to the request that failed.
export function safeRequestError(error: unknown, key: string, imageDataUrl?: string): string {
  const message = error instanceof Error ? error.message : 'Request failed';
  const cleaned = message.replace(/data:image\/[^\s"']+/g, '[image payload omitted]');
  const privateSafe = imageDataUrl?.includes(',')
    ? cleaned.split(imageDataUrl.split(',')[1]).join('[image payload omitted]')
    : cleaned;
  return (key ? privateSafe.split(key).join('[redacted]') : privateSafe).slice(0, 2000);
}
