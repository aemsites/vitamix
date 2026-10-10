/* eslint-disable no-await-in-loop */

const IMAGE_TYPES = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

function extension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const isZip = (name) => extension(name) === 'zip';
const imageType = (name) => IMAGE_TYPES[extension(name)];

/** OS/archive noise such as `.DS_Store`, `._foo.jpg` and `__MACOSX/`. */
function isJunk(path) {
  return path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');
}

/** Minimal ZIP reader (stored + deflate) using the native DecompressionStream. */
async function unzip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a valid zip file');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported');

  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (!path.endsWith('/')) {
      const localHeader = 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const start = local + localHeader;
      entries.push({
        path,
        method,
        read: () => bytes.subarray(start, start + size),
      });
    }
  }

  return Promise.all(entries
    .filter(({ path }) => !isJunk(path) && (imageType(path) || isZip(path)))
    .map(async ({ path, method, read }) => {
      const raw = new Blob([read()]);
      let data;
      if (method === 0) data = raw;
      else if (method === 8) {
        data = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      } else throw new Error(`${path}: unsupported zip compression (${method})`);
      const name = path.split('/').pop();
      return { path, file: new File([data], name, { type: imageType(name) || 'application/zip' }) };
    }));
}

function readEntries(reader) {
  return new Promise((resolve, reject) => { reader.readEntries(resolve, reject); });
}

async function walkEntry(entry, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => { entry.file(resolve, reject); });
    out.push({ path: entry.fullPath.replace(/^\/+/, ''), file });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch;
    // readEntries returns results in chunks until an empty batch
    do {
      batch = await readEntries(reader);
      for (let i = 0; i < batch.length; i += 1) await walkEntry(batch[i], out);
    } while (batch.length);
  }
}

/**
 * Must be called synchronously in the `drop` handler: DataTransfer items are only
 * readable during the event, so entries are captured first and walked afterwards.
 * @returns {Promise<{images: {path: string, file: File}[], skipped: string[]}>}
 */
export function readDrop(dataTransfer) {
  const entries = [...(dataTransfer.items || [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  const files = [...dataTransfer.files];
  return (async () => {
    const found = [];
    if (entries.length) {
      for (let i = 0; i < entries.length; i += 1) await walkEntry(entries[i], found);
    } else {
      found.push(...files.map((file) => ({ path: file.name, file })));
    }
    // eslint-disable-next-line no-use-before-define
    return expand(found);
  })();
}

/** Unpacks zips (their name becomes a folder) and keeps only image files. */
async function expand(found) {
  const images = [];
  const skipped = [];
  const queue = [...found];
  while (queue.length) {
    const { path, file } = queue.shift();
    if (isJunk(path)) {
      // ignore silently
    } else if (isZip(path)) {
      try {
        const base = path.replace(/\.zip$/i, '');
        const inner = await unzip(file);
        queue.push(...inner.map((item) => ({ path: `${base}/${item.path}`, file: item.file })));
      } catch (error) {
        skipped.push(`${path} (${error.message})`);
      }
    } else if (imageType(path)) {
      const typed = file.type ? file : new File([file], file.name, { type: imageType(path) });
      images.push({ path, file: typed });
    } else {
      skipped.push(path);
    }
  }
  return { images, skipped };
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Lowercase, dash-separated name plus extension: `Café_Front (2).JPEG` -> `cafe-front-2.jpg` */
export function cleanFileName(name) {
  const ext = slugify(extension(name)).replace(/-/g, '');
  const base = ext ? name.slice(0, name.lastIndexOf('.')) : name;
  const slug = slugify(base) || 'image';
  return ext ? `${slug}.${ext === 'jpeg' ? 'jpg' : ext}` : slug;
}
