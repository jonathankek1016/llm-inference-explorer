/** Product media stays in memory. These are application safety bounds, not provider limits. */
export const imageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMime = (typeof imageMimeTypes)[number];
export const maxImageBytes = 10 * 1024 * 1024;
export interface ImageInput {
  readonly id: string;
  readonly mime: ImageMime;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly dataUrl: string;
}
export interface GeneratedImage {
  readonly id: string;
  readonly src: string;
  readonly mime?: ImageMime;
  readonly revisedPrompt?: string;
}
export function rasterMime(bytes: Uint8Array): ImageMime | undefined {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
}
export function validateImage(input: ImageInput) {
  if (
    !imageMimeTypes.includes(input.mime) ||
    input.bytes <= 0 ||
    input.bytes > maxImageBytes ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.width * input.height > 40_000_000
  )
    throw new Error('Use a PNG, JPEG or WebP up to 10 MiB and 40 megapixels (app limits).');
  const prefix = `data:${input.mime};base64,`;
  if (!input.dataUrl.startsWith(prefix)) throw new Error('Invalid image payload.');
  const encoded = input.dataUrl.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > Math.ceil(maxImageBytes / 3) * 4)
    throw new Error('Invalid image payload.');
  const decoded = atob(encoded);
  if (
    decoded.length !== input.bytes ||
    rasterMime(Uint8Array.from(decoded.slice(0, 12), (c) => c.charCodeAt(0))) !== input.mime
  )
    throw new Error('Image content does not match its declared type.');
}
export async function readImage(file: File): Promise<ImageInput> {
  if (!imageMimeTypes.includes(file.type as ImageMime) || !file.size || file.size > maxImageBytes)
    throw new Error('Choose a PNG, JPEG or WebP up to 10 MiB (app limit).');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (rasterMime(bytes) !== file.type) throw new Error('Image content does not match its declared type.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be decoded.');
  }
  const width = bitmap.width,
    height = bitmap.height;
  bitmap.close();
  if (width * height > 40_000_000) throw new Error('Image exceeds the app limit of 40 megapixels.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('This image could not be read.'));
    reader.readAsDataURL(file);
  });
  const input = {
    id: `image:${crypto.randomUUID()}`,
    mime: file.type as ImageMime,
    bytes: file.size,
    width,
    height,
    dataUrl,
  };
  validateImage(input);
  return Object.freeze(input);
}
export function imageMetadata({ id, mime, bytes, width, height }: ImageInput) {
  return { id, mime, bytes, width, height };
}
/** Never accept HTML, SVG, arbitrary data URLs, credentials or executable URL schemes. */
export function normalizeGeneratedImages(data: unknown): GeneratedImage[] {
  if (!Array.isArray(data) || !data.length || data.length > 10)
    throw new Error('No usable generated image was returned.');
  return data.map((item: Record<string, unknown>) => {
    if (!item || typeof item !== 'object') throw new Error('Malformed generated image.');
    let src: string, mime: ImageMime | undefined;
    if (typeof item.b64_json === 'string') {
      if (item.b64_json.length > 40 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json))
        throw new Error('Invalid or oversized generated image payload.');
      let head: string;
      try {
        head = atob(item.b64_json.slice(0, 16));
      } catch {
        throw new Error('Invalid generated image encoding.');
      }
      mime = rasterMime(Uint8Array.from(head, (c) => c.charCodeAt(0)));
      if (!mime) throw new Error('Unsupported generated image type.');
      src = `data:${mime};base64,${item.b64_json}`;
    } else if (typeof item.url === 'string') {
      let url: URL;
      try {
        url = new URL(item.url);
      } catch {
        throw new Error('Invalid generated image URL.');
      }
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Generated image URLs must use HTTPS without credentials.');
      src = url.href;
    } else throw new Error('No usable generated image was returned.');
    return {
      id: `media:${crypto.randomUUID()}`,
      src,
      mime,
      ...(typeof item.revised_prompt === 'string'
        ? { revisedPrompt: item.revised_prompt.slice(0, 12000) }
        : {}),
    };
  });
}
