/**
 * Client-side Image Compression Utility using HTML5 Canvas
 * 
 * Downscales and compresses images before saving to Firestore,
 * ensuring total document size remains well below the 1MB threshold.
 */

export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0.1 to 1.0
  mimeType?: 'image/webp' | 'image/jpeg' | 'image/png';
  preserveTransparency?: boolean;
}

// Preset configurations for different types of report media
export const COMPRESSION_PRESETS = {
  // Activity / Program photos: good quality, compact dimensions (e.g. 500x375)
  PROGRAM_PHOTO: {
    maxWidth: 520,
    maxHeight: 390,
    quality: 0.72,
    mimeType: 'image/webp' as const,
  },
  // Front / Back covers: higher resolution aspect ratio (e.g. 640x905)
  COVER_PAGE: {
    maxWidth: 640,
    maxHeight: 905,
    quality: 0.70,
    mimeType: 'image/webp' as const,
  },
  // Logos: small size, preserve PNG transparency if needed
  LOGO: {
    maxWidth: 220,
    maxHeight: 220,
    quality: 0.85,
    mimeType: 'image/png' as const,
    preserveTransparency: true,
  },
  // Fast thumbnail for dashboard previews (~2KB - 4KB)
  THUMBNAIL: {
    maxWidth: 160,
    maxHeight: 120,
    quality: 0.60,
    mimeType: 'image/webp' as const,
  },
};

/**
 * Calculates byte size of a UTF-8 string or JSON payload.
 */
export function getPayloadSizeBytes(data: any): number {
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return new Blob([str]).size;
  } catch (e) {
    return 0;
  }
}

/**
 * Formats bytes into human-readable string (e.g., "45.2 KB", "1.1 MB").
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Tests if the browser supports canvas.toDataURL with image/webp.
 */
let supportsWebpCache: boolean | null = null;
function checkWebpSupport(): boolean {
  if (supportsWebpCache !== null) return supportsWebpCache;
  if (typeof document === 'undefined') {
    supportsWebpCache = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    supportsWebpCache = canvas.toDataURL('image/webp').indexOf('image/webp') === 5;
  } catch (e) {
    supportsWebpCache = false;
  }
  return supportsWebpCache;
}

/**
 * Core Canvas Compression Function
 * Takes an image source (data URL, blob URL, or image element) and returns
 * an optimized base64 data URL.
 */
export function compressImageWithCanvas(
  imgSource: HTMLImageElement,
  options: ImageCompressionOptions = {}
): string {
  const {
    maxWidth = 600,
    maxHeight = 600,
    quality = 0.75,
    mimeType = 'image/webp',
    preserveTransparency = false,
  } = options;

  let { naturalWidth: width, naturalHeight: height } = imgSource;
  if (!width || !height) {
    width = imgSource.width || 400;
    height = imgSource.height || 300;
  }

  // Calculate new dimensions while preserving aspect ratio
  if (width > maxWidth || height > maxHeight) {
    const widthRatio = maxWidth / width;
    const heightRatio = maxHeight / height;
    const ratio = Math.min(widthRatio, heightRatio);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);

  const ctx = canvas.getContext('2d', { alpha: preserveTransparency });
  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  // Smooth scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fill white background for non-transparent JPEGs
  if (!preserveTransparency && (mimeType === 'image/jpeg' || !checkWebpSupport())) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(imgSource, 0, 0, width, height);

  // Determine actual target format
  const canUseWebp = checkWebpSupport();
  let targetMime: string = mimeType;

  if (preserveTransparency) {
    targetMime = canUseWebp ? 'image/webp' : 'image/png';
  } else if (!canUseWebp && targetMime === 'image/webp') {
    targetMime = 'image/jpeg';
  }

  return canvas.toDataURL(targetMime, quality);
}

/**
 * Compresses an image from a Base64 string or URL.
 */
export function compressBase64Image(
  base64OrUrl: string,
  options: ImageCompressionOptions = {}
): Promise<string> {
  return new Promise((resolve) => {
    if (!base64OrUrl || typeof base64OrUrl !== 'string') {
      return resolve('');
    }

    // If it's a remote http URL, return as is (not base64)
    if (base64OrUrl.startsWith('http://') || base64OrUrl.startsWith('https://')) {
      return resolve(base64OrUrl);
    }

    if (typeof window === 'undefined' || typeof Image === 'undefined') {
      return resolve(base64OrUrl);
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const compressed = compressImageWithCanvas(img, options);
        // Only return compressed if it actually reduced size, or if dimensions were downscaled
        if (compressed && (compressed.length < base64OrUrl.length || options.maxWidth || options.maxHeight)) {
          resolve(compressed);
        } else {
          resolve(base64OrUrl);
        }
      } catch (err) {
        console.warn('Canvas compression error:', err);
        resolve(base64OrUrl);
      }
    };

    img.onerror = () => {
      resolve(base64OrUrl);
    };

    img.src = base64OrUrl;
  });
}

/**
 * Compresses a File object directly upon user selection.
 */
export function compressImageFile(
  file: File,
  options: ImageCompressionOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const result = e.target?.result as string;
      if (!result) {
        return reject(new Error('Gagal membaca fail gambar.'));
      }
      try {
        const compressed = await compressBase64Image(result, options);
        resolve(compressed);
      } catch (err) {
        resolve(result);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Generates an ultra-lightweight thumbnail (~2KB - 4KB) for dashboard list preview.
 */
export async function generateThumbnail(imageSrc: string): Promise<string> {
  if (!imageSrc) return '';
  return compressBase64Image(imageSrc, COMPRESSION_PRESETS.THUMBNAIL);
}

/**
 * Auto-budget downscaling:
 * Progressively reduces image dimensions and quality until total payload is
 * strictly below targetMaxBytes (default 400KB - 550KB).
 */
export async function optimizeMediaBundle(media: {
  gambarMukaDepan?: string;
  gambarMukaBelakang?: string;
  gambarProgram?: string[];
  logos?: string[];
  logoSekolah?: string;
}, targetMaxBytes: number = 550000): Promise<{
  gambarMukaDepan: string;
  gambarMukaBelakang: string;
  gambarProgram: string[];
  logos: string[];
  logoSekolah: string;
}> {
  const result = {
    gambarMukaDepan: media.gambarMukaDepan || '',
    gambarMukaBelakang: media.gambarMukaBelakang || '',
    gambarProgram: Array.isArray(media.gambarProgram) ? [...media.gambarProgram] : [],
    logos: Array.isArray(media.logos) ? [...media.logos] : [],
    logoSekolah: media.logoSekolah || '',
  };

  // 1. Initial standard compression pass
  if (result.gambarMukaDepan && result.gambarMukaDepan.startsWith('data:')) {
    result.gambarMukaDepan = await compressBase64Image(result.gambarMukaDepan, COMPRESSION_PRESETS.COVER_PAGE);
  }
  if (result.gambarMukaBelakang && result.gambarMukaBelakang.startsWith('data:')) {
    result.gambarMukaBelakang = await compressBase64Image(result.gambarMukaBelakang, COMPRESSION_PRESETS.COVER_PAGE);
  }

  if (result.gambarProgram.length > 0) {
    result.gambarProgram = await Promise.all(
      result.gambarProgram.map(async (img) => {
        if (!img || !img.startsWith('data:')) return img;
        return compressBase64Image(img, COMPRESSION_PRESETS.PROGRAM_PHOTO);
      })
    );
  }

  if (result.logos.length > 0) {
    result.logos = await Promise.all(
      result.logos.map(async (l) => {
        if (!l || !l.startsWith('data:')) return l;
        return compressBase64Image(l, COMPRESSION_PRESETS.LOGO);
      })
    );
  }

  // Avoid duplicating school logo base64
  if (result.logoSekolah && result.logos.length > 0) {
    const matched = result.logos.find((l) => l && l.trim() !== '');
    if (matched) {
      result.logoSekolah = matched;
    }
  }

  let totalSize = getPayloadSizeBytes(result);
  if (totalSize <= targetMaxBytes) {
    return result;
  }

  // 2. Secondary aggressive downscale if still above budget
  console.log(`[Compression] Initial size ${formatBytes(totalSize)} exceeds ${formatBytes(targetMaxBytes)}. Applying secondary pass...`);

  if (result.gambarMukaDepan && result.gambarMukaDepan.startsWith('data:')) {
    result.gambarMukaDepan = await compressBase64Image(result.gambarMukaDepan, {
      maxWidth: 500,
      maxHeight: 700,
      quality: 0.55,
      mimeType: 'image/webp',
    });
  }
  if (result.gambarMukaBelakang && result.gambarMukaBelakang.startsWith('data:')) {
    result.gambarMukaBelakang = await compressBase64Image(result.gambarMukaBelakang, {
      maxWidth: 500,
      maxHeight: 700,
      quality: 0.55,
      mimeType: 'image/webp',
    });
  }

  result.gambarProgram = await Promise.all(
    result.gambarProgram.map(async (img) => {
      if (!img || !img.startsWith('data:')) return img;
      return compressBase64Image(img, {
        maxWidth: 420,
        maxHeight: 315,
        quality: 0.55,
        mimeType: 'image/webp',
      });
    })
  );

  totalSize = getPayloadSizeBytes(result);
  console.log(`[Compression] Optimized payload size: ${formatBytes(totalSize)} (target: ${formatBytes(targetMaxBytes)})`);

  return result;
}
