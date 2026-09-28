import QRCode from 'qrcode';

// Cache generated QR data URLs to avoid redundant canvas computations
const qrCache = new Map<string, string>();

/**
 * Creates a clean, URL-safe slug from a program name
 */
export function slugifyProgramName(name: string): string {
  if (!name) return 'laporan-opr';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Generates the digital link for a specific OPR report,
 * incorporating the unique reportId, program name, and PDF format.
 */
export function getReportDigitalUrl(reportId?: string, namaProgram?: string): string {
  let origin = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : 'https://ais-pre-2qcyvdc5tgaofofqcbk7hv-42468406007.asia-southeast1.run.app';

  // In AI Studio preview/dev environment: 'ais-dev-' requires internal Google authentication,
  // causing smartphone cameras to fail or show login blocks.
  // Converting 'ais-dev-' to the public 'ais-pre-' allows any smartphone scanning the QR code
  // to directly open the live OPR in PDF format without authentication barrier!
  if (origin.includes('ais-dev-')) {
    origin = origin.replace('ais-dev-', 'ais-pre-');
  } else if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    origin = 'https://ais-pre-2qcyvdc5tgaofofqcbk7hv-42468406007.asia-southeast1.run.app';
  }

  const validId = reportId && reportId.trim() ? reportId.trim() : 'laporan';
  const programSlug = slugifyProgramName(namaProgram || 'program');

  // URL containing reportId, program name, and explicit format=pdf for direct OPR PDF view
  return `${origin}/?reportId=${encodeURIComponent(validId)}&program=${encodeURIComponent(programSlug)}&format=pdf`;
}

/**
 * Generates a base64 Data URL for a given text using QRCode
 */
export async function generateQrDataUrl(text: string): Promise<string> {
  if (!text) return '';
  if (qrCache.has(text)) {
    return qrCache.get(text)!;
  }

  try {
    const dataUrl = await QRCode.toDataURL(text, {
      width: 200,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    });
    qrCache.set(text, dataUrl);
    return dataUrl;
  } catch (err) {
    console.error('Failed to generate QR Code:', err);
    return '';
  }
}

/**
 * Synchronous retrieval from cache if already generated
 */
export function getCachedQrDataUrl(text: string): string | null {
  return qrCache.get(text) || null;
}

/**
 * Helper to render the QR Code badge HTML string for print and export (front cover)
 */
export function getCoverQrHtmlBadge(reportId: string, namaProgram: string, qrDataUrl: string, isSmallPreview = false): string {
  const url = getReportDigitalUrl(reportId, namaProgram);
  const displayUrl = url.replace(/^https?:\/\//, '');
  const title = namaProgram || 'Laporan OPR SK Tudan';
  const qrSize = isSmallPreview ? 28 : 34;

  return `
    <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255, 255, 255, 0.96); border: 1px solid rgba(203, 213, 225, 0.95); border-radius: 6px; padding: 2px 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 90%; pointer-events: auto;">
      <div style="flex-shrink: 0; background: #ffffff; border-radius: 4px; padding: 1px; border: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: center;">
        <img src="${qrDataUrl}" alt="QR Code OPR PDF" style="width: ${qrSize}px; height: ${qrSize}px; display: block;" />
      </div>
      <div style="text-align: left; font-family: Arial, sans-serif; line-height: 1.15; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 4px; font-size: ${isSmallPreview ? '6.5px' : '7.5px'}; font-weight: bold; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.03em;">
          <span>Imbas QR: OPR (PDF)</span>
          <span style="background: #dc2626; color: #ffffff; font-size: ${isSmallPreview ? '5px' : '6px'}; font-weight: bold; padding: 0 3px; border-radius: 2px; text-transform: uppercase;">PDF</span>
        </div>
        <div style="font-size: ${isSmallPreview ? '6px' : '7px'}; color: #0f172a; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;">
          ${title}
        </div>
        <a href="${url}" target="_blank" style="font-size: ${isSmallPreview ? '5.5px' : '6.5px'}; color: #2563eb; text-decoration: underline; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; max-width: 220px;">
          ${displayUrl}
        </a>
      </div>
    </div>
  `;
}

/**
 * Helper to render a centered prominent QR Code badge for the back cover
 */
export function getBackCoverQrHtmlBadge(reportId: string, namaProgram: string, qrDataUrl: string): string {
  const url = getReportDigitalUrl(reportId, namaProgram);
  const displayUrl = url.replace(/^https?:\/\//, '');
  const title = namaProgram || 'Laporan OPR SK Tudan';

  return `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: rgba(255, 255, 255, 0.96); border: 2px solid #1e3a8a; border-radius: 14px; padding: 16px 22px; box-shadow: 0 4px 14px rgba(0,0,0,0.1); max-width: 360px; width: 88%; margin: 0 auto; box-sizing: border-box; pointer-events: auto;">
      <div style="background: #ffffff; padding: 6px; border-radius: 10px; border: 1px solid #cbd5e1; margin-bottom: 10px; display: inline-flex; align-items: center; justify-content: center;">
        <img src="${qrDataUrl}" alt="QR Code OPR PDF" style="width: 100px; height: 100px; display: block;" />
      </div>
      <div style="font-family: Arial, sans-serif; line-height: 1.25;">
        <div style="display: inline-flex; align-items: center; gap: 6px; font-size: 10.5pt; font-weight: bold; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px;">
          <span>Imbas QR: Dokumen OPR</span>
          <span style="background: #dc2626; color: #ffffff; font-size: 8pt; font-weight: bold; padding: 1px 5px; border-radius: 4px; text-transform: uppercase;">PDF</span>
        </div>
        <div style="font-size: 9.5pt; font-weight: bold; color: #0f172a; margin-bottom: 4px; line-height: 1.2; max-width: 300px; word-break: break-word;">
          ${title}
        </div>
        <a href="${url}" target="_blank" style="font-size: 8pt; color: #2563eb; text-decoration: underline; word-break: break-all; font-family: monospace; display: block; margin-bottom: 4px;">
          ${displayUrl}
        </a>
        <div style="font-size: 7.5pt; color: #64748b; font-style: italic;">
          Imbas untuk membuka & memuat turun dokumen OPR rasmi dalam format PDF
        </div>
      </div>
    </div>
  `;
}
