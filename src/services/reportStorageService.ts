import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  serverTimestamp, 
  Timestamp 
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { 
  optimizeMediaBundle, 
  generateThumbnail, 
  getPayloadSizeBytes, 
  formatBytes 
} from '../utils/imageCompression';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((p) => ({
        providerId: p.providerId,
        email: p.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface SaveReportResult {
  id: string;
  mainDocBytes: number;
  mediaDocBytes: number;
  totalBytes: number;
  formattedSize: string;
}

/**
 * Saves a report using the optimized separate-storage strategy.
 * 
 * - Compresses all images client-side with Canvas
 * - Stores large image strings in a dedicated 'report_media' collection
 * - Keeps only lightweight metadata and thumbnail in the main 'reports' document
 * - Prevents hitting the 1MB Firestore document threshold
 */
export async function saveReportWithMedia(
  reportData: any,
  reportId?: string,
  authorUid?: string
): Promise<SaveReportResult> {
  const docRefId = reportId || doc(collection(db, 'reports')).id;

  // 1. Separate media fields from textual metadata
  const rawMedia = {
    gambarMukaDepan: reportData.gambarMukaDepan || '',
    gambarMukaBelakang: reportData.gambarMukaBelakang || '',
    gambarProgram: Array.isArray(reportData.gambarProgram) ? reportData.gambarProgram : [],
    logos: Array.isArray(reportData.logos) ? reportData.logos : [],
    logoSekolah: reportData.logoSekolah || '',
  };

  // 2. Client-side canvas compression on all media
  const optimizedMedia = await optimizeMediaBundle(rawMedia, 550000);

  // 3. Generate a tiny thumbnail (~2-3 KB) for instant dashboard previews
  const firstPhoto = optimizedMedia.gambarProgram.find((img) => img && img.trim() !== '') || optimizedMedia.gambarMukaDepan || '';
  const thumbnail = firstPhoto ? await generateThumbnail(firstPhoto) : '';

  const now = new Date();
  const mediaDocBytes = getPayloadSizeBytes(optimizedMedia);

  // 4. Construct lightweight main report document (text + metadata only)
  const mainReportPayload: any = {
    id: docRefId,
    namaProgram: reportData.namaProgram || '',
    singkatanProgram: reportData.singkatanProgram || '',
    tarikhPelaksanaan: reportData.tarikhPelaksanaan || '',
    tempat: reportData.tempat || '',
    sasaran: reportData.sasaran || '',
    anjuran: reportData.anjuran || '',
    objektif: reportData.objektif || '',
    penilaianKeberkesanan: reportData.penilaianKeberkesanan || '',
    kehadiran: reportData.kehadiran || '',
    kekuatan: reportData.kekuatan || '',
    perkaraPerluPenambahbaikan: reportData.perkaraPerluPenambahbaikan || '',
    cadanganPenambahbaikan: reportData.cadanganPenambahbaikan || '',
    disediakanOleh: reportData.disediakanOleh || '',
    jawatanDisediakanOleh: reportData.jawatanDisediakanOleh || '',
    disahkanOleh: reportData.disahkanOleh || '',
    jawatanDisahkanOleh: reportData.jawatanDisahkanOleh || '',
    peneranganGambar: Array.isArray(reportData.peneranganGambar) ? reportData.peneranganGambar : [],
    logoScales: Array.isArray(reportData.logoScales) ? reportData.logoScales : [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    
    // Metadata about media (no large base64 strings!)
    hasMedia: true,
    mediaStorageType: 'report_media',
    thumbnail: thumbnail, // Lightweight 160px preview
    gambarProgramCount: optimizedMedia.gambarProgram.filter((img) => img && img.trim() !== '').length,
    hasCover: !!optimizedMedia.gambarMukaDepan,
    hasBackCover: !!optimizedMedia.gambarMukaBelakang,
    logosCount: optimizedMedia.logos.filter((l) => l && l.trim() !== '').length,
    
    // Size telemetry
    mediaDocSizeBytes: mediaDocBytes,
    
    authorUid: authorUid || reportData.authorUid || auth.currentUser?.uid || 'anonymous',
    authorEmail: auth.currentUser?.email || reportData.authorEmail || '',
    updatedAt: serverTimestamp(),
  };

  // Set createdAt if new document
  if (!reportId || !reportData.createdAt) {
    mainReportPayload.createdAt = serverTimestamp();
  } else {
    mainReportPayload.createdAt = reportData.createdAt;
  }

  const mainDocBytes = getPayloadSizeBytes(mainReportPayload);
  mainReportPayload.mainDocSizeBytes = mainDocBytes;

  const mediaDocPayload = {
    reportId: docRefId,
    gambarMukaDepan: optimizedMedia.gambarMukaDepan,
    gambarMukaBelakang: optimizedMedia.gambarMukaBelakang,
    gambarProgram: optimizedMedia.gambarProgram,
    logos: optimizedMedia.logos,
    logoSekolah: optimizedMedia.logoSekolah,
    updatedAt: serverTimestamp(),
  };

  // 5. Write to Firestore: Save media in 'report_media' and metadata in 'reports'
  try {
    const mediaDocRef = doc(db, 'report_media', docRefId);
    await setDoc(mediaDocRef, mediaDocPayload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `report_media/${docRefId}`);
  }

  try {
    const reportDocRef = doc(db, 'reports', docRefId);
    await setDoc(reportDocRef, mainReportPayload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `reports/${docRefId}`);
  }

  const totalBytes = mainDocBytes + mediaDocBytes;

  return {
    id: docRefId,
    mainDocBytes,
    mediaDocBytes,
    totalBytes,
    formattedSize: formatBytes(totalBytes),
  };
}

/**
 * Loads a report along with its media from 'report_media' (or legacy inline media).
 */
export async function getReportWithMedia(reportId: string): Promise<any | null> {
  let reportData: any = null;

  // 1. Fetch main report document
  try {
    const reportSnap = await getDoc(doc(db, 'reports', reportId));
    if (!reportSnap.exists()) {
      return null;
    }
    reportData = { id: reportSnap.id, ...reportSnap.data() };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `reports/${reportId}`);
  }

  // 2. Fetch separate media from 'report_media' if referenced or present
  try {
    const mediaSnap = await getDoc(doc(db, 'report_media', reportId));
    if (mediaSnap.exists()) {
      const mediaData = mediaSnap.data();
      reportData.gambarMukaDepan = mediaData.gambarMukaDepan || reportData.gambarMukaDepan || '';
      reportData.gambarMukaBelakang = mediaData.gambarMukaBelakang || reportData.gambarMukaBelakang || '';
      reportData.gambarProgram = Array.isArray(mediaData.gambarProgram) && mediaData.gambarProgram.length > 0 
        ? mediaData.gambarProgram 
        : (reportData.gambarProgram || []);
      reportData.logos = Array.isArray(mediaData.logos) && mediaData.logos.length > 0 
        ? mediaData.logos 
        : (reportData.logos || []);
      reportData.logoSekolah = mediaData.logoSekolah || reportData.logoSekolah || '';
    }
  } catch (err) {
    console.warn(`[reportStorageService] Note: No separate media for ${reportId} or error:`, err);
  }

  return reportData;
}

/**
 * Deletes a report and its associated media document.
 */
export async function deleteReportWithMedia(reportId: string): Promise<void> {
  // Delete main report document
  try {
    await deleteDoc(doc(db, 'reports', reportId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `reports/${reportId}`);
  }

  // Delete associated media document if it exists
  try {
    await deleteDoc(doc(db, 'report_media', reportId));
  } catch (error) {
    console.warn(`[reportStorageService] Could not delete report_media/${reportId}:`, error);
  }
}

/**
 * Batch fetches media for a list of reports (used for batch printing in Dashboard).
 */
export async function batchHydrateReportMedia(reportsList: any[]): Promise<any[]> {
  return Promise.all(
    reportsList.map(async (r) => {
      // If report already has full media loaded, return as is
      if (
        (Array.isArray(r.gambarProgram) && r.gambarProgram.length > 0) ||
        r.gambarMukaDepan
      ) {
        return r;
      }

      try {
        const mediaSnap = await getDoc(doc(db, 'report_media', r.id));
        if (mediaSnap.exists()) {
          const media = mediaSnap.data();
          return {
            ...r,
            gambarMukaDepan: media.gambarMukaDepan || r.gambarMukaDepan || '',
            gambarMukaBelakang: media.gambarMukaBelakang || r.gambarMukaBelakang || '',
            gambarProgram: media.gambarProgram || r.gambarProgram || [],
            logos: media.logos || r.logos || [],
            logoSekolah: media.logoSekolah || r.logoSekolah || '',
          };
        }
      } catch (err) {
        console.warn(`[reportStorageService] Error hydrating media for ${r.id}:`, err);
      }
      return r;
    })
  );
}
