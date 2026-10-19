export const SAFE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type SafeImageType = typeof SAFE_IMAGE_TYPES[number];

export function isSafeImageType(value: string): value is SafeImageType {
  return SAFE_IMAGE_TYPES.includes(value as SafeImageType);
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function hasValidImageSignature(mimeType: SafeImageType, bytes: Uint8Array) {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

function jpegDimensions(bytes: Uint8Array) {
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return undefined;
    if (startOfFrame.has(marker)) return {
      width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      height: (bytes[offset + 5] << 8) | bytes[offset + 6],
    };
    offset += 2 + length;
  }
  return undefined;
}

function webpDimensions(bytes: Uint8Array) {
  const type = ascii(bytes, 12, 4);
  if (type === 'VP8X' && bytes.length >= 30) return {
    width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
    height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
  };
  if (type === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) return {
    width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
    height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
  };
  if (type === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return {
    width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
    height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
  };
  return undefined;
}

export function imageDimensions(mimeType: SafeImageType, bytes: Uint8Array) {
  if (mimeType === 'image/png' && bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR') return {
    width: ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0,
    height: ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0,
  };
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes);
  if (mimeType === 'image/webp') return webpDimensions(bytes);
  return undefined;
}

export function hasSafeImageDimensions(mimeType: SafeImageType, bytes: Uint8Array) {
  const dimensions = imageDimensions(mimeType, bytes);
  return Boolean(dimensions && dimensions.width > 0 && dimensions.height > 0
    && dimensions.width <= 12_000 && dimensions.height <= 12_000
    && dimensions.width * dimensions.height <= 64_000_000);
}

function containsText(bytes: Uint8Array, text: string) {
  const needle = new TextEncoder().encode(text);
  for (let index = bytes.indexOf(needle[0]); index >= 0; index = bytes.indexOf(needle[0], index + 1)) {
    if (needle.every((value, offset) => bytes[index + offset] === value)) return true;
  }
  return false;
}

function isAllowedJpegApplicationSegment(marker: number, bytes: Uint8Array, dataStart: number) {
  if (marker === 0xe0) return ['JFIF\0', 'JFXX\0'].includes(ascii(bytes, dataStart, 5));
  if (marker === 0xe2) return ascii(bytes, dataStart, 12) === 'ICC_PROFILE\0';
  if (marker === 0xee) return ascii(bytes, dataStart, 5) === 'Adobe';
  return false;
}

export function hasUnsafeImageMetadata(mimeType: SafeImageType, bytes: Uint8Array) {
  if (mimeType === 'image/jpeg') {
    let offset = 2;
    while (offset + 3 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xfe || (marker >= 0xe0 && marker <= 0xef && !isAllowedJpegApplicationSegment(marker, bytes, offset + 4))) return true;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + 2 + length > bytes.length) return true;
      offset += 2 + length;
    }
  }
  if (mimeType === 'image/png') {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
      const type = ascii(bytes, offset + 4, 4);
      if (['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(type)) return true;
      if (length > bytes.length - offset - 12) return true;
      offset += 12 + length;
      if (type === 'IEND') break;
    }
  }
  if (mimeType === 'image/webp') {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, 4);
      const length = (bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)) >>> 0;
      if (type === 'EXIF' || type === 'XMP ') return true;
      if (length > bytes.length - offset - 8) return true;
      offset += 8 + length + (length % 2);
    }
  }
  return ['Photoshop 3.0', '<x:xmpmeta', 'GPSLatitude', 'impeccable:prompt'].some((text) => containsText(bytes, text));
}
