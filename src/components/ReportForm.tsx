import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp, getDocFromCache } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { 
  compressImageFile, 
  compressBase64Image as canvasCompressBase64, 
  COMPRESSION_PRESETS, 
  getPayloadSizeBytes, 
  formatBytes 
} from '../utils/imageCompression';
import { 
  saveReportWithMedia, 
  getReportWithMedia 
} from '../services/reportStorageService';
import { ArrowLeft, Save, Trash2, Upload, X, Wand2, ImagePlus, Sparkles, Loader2, FileText, BarChart3, CheckCircle2, FileUp, ChevronLeft, ChevronRight, Eye, RefreshCw, Image as ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { analyzeImageForReport, generateImage, editImage, generateTextSuggestion, generateImageDescription, extractInfoFromKertasKerja, analyzeFeedbackForm } from '../services/geminiService';
import { getGoogleAccessToken, createDriveFolder, uploadImageToDrive, uploadTextToDrive } from '../services/driveService';
import { requestDriveAccess } from '../services/authService';

import { TeacherCombobox } from './TeacherCombobox';
import { GoogleDriveImagePicker } from './GoogleDriveImagePicker';
import CoverQrBadge from './CoverQrBadge';

interface ReportFormProps {
  reportId?: string;
  onBack: () => void;
  onSaved: (id: string) => void;
}

function autoTrimCanvas(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = sourceCanvas.getContext('2d');
  if (!ctx) return sourceCanvas;
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  let minX = w, minY = h, maxX = 0, maxY = 0;
  let hasContent = false;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const a = data[idx + 3];
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const isTransparent = a < 25;
      const isWhite = r > 245 && g > 245 && b > 245 && a > 200;

      if (!isTransparent && !isWhite) {
        hasContent = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!hasContent || minX >= maxX || minY >= maxY) return sourceCanvas;

  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.min(w - cropX, (maxX - minX) + pad * 2);
  const cropH = Math.min(h - cropY, (maxY - minY) + pad * 2);

  if (cropW < w * 0.94 || cropH < h * 0.94) {
    const cropped = document.createElement('canvas');
    cropped.width = cropW;
    cropped.height = cropH;
    const cCtx = cropped.getContext('2d');
    if (cCtx) {
      cCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      return cropped;
    }
  }
  return sourceCanvas;
}

export default function ReportForm({ reportId, onBack, onSaved }: ReportFormProps) {
  const [loading, setLoading] = useState(!!reportId);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<number, number>>({});
  const [logoUploadProgress, setLogoUploadProgress] = useState<number | null>(null);
  const [uploadingLogoSlot, setUploadingLogoSlot] = useState<number | null>(null);
  const formLogoInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExtractingKertasKerja, setIsExtractingKertasKerja] = useState(false);
  const [isAnalyzingFeedback, setIsAnalyzingFeedback] = useState(false);
  const [extractedKertasKerjaSummary, setExtractedKertasKerjaSummary] = useState<string | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [generatingField, setGeneratingField] = useState<string | null>(null);
  const [showOprPreview, setShowOprPreview] = useState(false);
  
  // AI Modal States
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAspectRatio, setAiAspectRatio] = useState('16:9');
  const [aiImageSize, setAiImageSize] = useState('1K');
  const [aiStudioQuality, setAiStudioQuality] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, string> | null>(null);
  const [senaraiGuru, setSenaraiGuru] = useState<Array<{nama: string, jawatan: string}>>([]);
  const [globalCoverTemplate, setGlobalCoverTemplate] = useState<string>('');
  const [globalBackCoverTemplate, setGlobalBackCoverTemplate] = useState<string>('');
  
  const [formData, setFormData] = useState({
    namaLaporan: '',
    namaProgram: '',
    singkatanProgram: '',
    tarikhPelaksanaan: '',
    tempat: '',
    sasaran: '',
    objektif: '',
    anjuran: '',
    kekuatan: '',
    perkaraPerluPenambahbaikan: '',
    cadanganPenambahbaikan: '',
    penilaianKeberkesanan: '',
    disediakanOleh: '',
    jawatanDisediakanOleh: '',
    disahkanOleh: '',
    jawatanDisahkanOleh: '',
    gambarProgram: [] as string[],
    peneranganGambar: [] as string[],
    logos: (() => {
      try {
        const cached = localStorage.getItem('defaultLogos');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return [...parsed, '', '', '', '', ''].slice(0, 6);
        }
      } catch (e) {}
      const defLogo = localStorage.getItem('defaultSchoolLogo');
      return [defLogo || '', '', '', '', '', ''];
    })() as string[],
    logoSekolah: localStorage.getItem('defaultSchoolLogo') || '',
    logoScales: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0] as number[],
    gambarMukaDepan: '',
    gambarMukaBelakang: ''
  });

  const handleAdjustLogoScale = (slotIndex: number, delta: number) => {
    setFormData(prev => {
      const currentScales = Array.isArray(prev.logoScales) && prev.logoScales.length >= 6
        ? [...prev.logoScales]
        : [1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
      const cur = currentScales[slotIndex] || 1.0;
      const nextScale = Math.max(0.6, Math.min(2.0, Math.round((cur + delta) * 10) / 10));
      currentScales[slotIndex] = nextScale;
      return {
        ...prev,
        logoScales: currentScales
      };
    });
  };

  const [localReportId, setLocalReportId] = useState<string | undefined>(reportId);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastAutoSaveTime, setLastAutoSaveTime] = useState<Date | null>(null);

  const formDataRef = useRef(formData);
  const lastSavedDataRef = useRef(JSON.stringify(formData));
  const localReportIdRef = useRef(reportId);
  const hasShownAutoSaveToastRef = useRef(false);

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  useEffect(() => {
    localReportIdRef.current = localReportId;
  }, [localReportId]);

  useEffect(() => {
    if (reportId && !localReportId) {
      setLocalReportId(reportId);
      localReportIdRef.current = reportId;
    }
  }, [reportId]);

  useEffect(() => {
    const autoSaveInterval = setInterval(async () => {
      // Don't auto-save if namaProgram is empty
      if (!formDataRef.current.namaProgram) return;

      const currentDataStr = JSON.stringify(formDataRef.current);
      if (currentDataStr !== lastSavedDataRef.current) {
        setIsAutoSaving(true);
        try {
          let docRefId = localReportIdRef.current;
          const reportLogos = Array.isArray(formDataRef.current.logos) && formDataRef.current.logos.length > 0
            ? [...formDataRef.current.logos, '', '', '', '', ''].slice(0, 6)
            : (formDataRef.current.logoSekolah ? [formDataRef.current.logoSekolah, '', '', '', '', ''] : ['', '', '', '', '', '']);
          const primaryLogo = reportLogos.find(l => l && l.trim() !== '') || formDataRef.current.logoSekolah || '';

          const reportData = {
            ...formDataRef.current,
            logos: reportLogos,
            logoSekolah: primaryLogo,
            updatedAt: serverTimestamp()
          };
          
          if (!docRefId) {
            const newDocRef = doc(collection(db, 'reports'));
            docRefId = newDocRef.id;
            setLocalReportId(docRefId);
            localReportIdRef.current = docRefId;
            reportData.authorUid = auth.currentUser?.uid || '';
            reportData.authorEmail = auth.currentUser?.email || '';
            reportData.authorName = auth.currentUser?.displayName || 'Guru';
            reportData.createdAt = serverTimestamp();
          }

          if (docRefId) {
            const cleanedData = {
              ...reportData,
              gambarProgram: reportData.gambarProgram.filter(url => url && url.trim() !== ''),
            };
            await saveReportWithMedia(cleanedData, docRefId, auth.currentUser?.uid);
            
            lastSavedDataRef.current = currentDataStr;
            setLastAutoSaveTime(new Date());

            if (!hasShownAutoSaveToastRef.current) {
              toast.success('Draf disimpan secara automatik', { 
                icon: '💾',
                style: {
                  borderRadius: '10px',
                  background: '#333',
                  color: '#fff',
                },
              });
              hasShownAutoSaveToastRef.current = true;
            }
          }
        } catch (error) {
          console.error("Autosave error", error);
        } finally {
          setIsAutoSaving(false);
        }
      }
    }, 30000);

    return () => clearInterval(autoSaveInterval);
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, 'settings', 'global');
        
        // Try cache first for instant load
        try {
          const cachedSnap = await getDocFromCache(docRef);
          if (cachedSnap.exists()) {
            const data = cachedSnap.data();
            if (data.senaraiGuru) setSenaraiGuru(data.senaraiGuru);
            if (data.coverTemplate) setGlobalCoverTemplate(data.coverTemplate);
            if (data.backCoverTemplate) setGlobalBackCoverTemplate(data.backCoverTemplate);
            if (!reportId) {
              const sysLogos: string[] = Array.isArray(data.logos) && data.logos.length > 0
                ? [...data.logos, '', '', '', '', ''].slice(0, 6)
                : (data.logoSekolah ? [data.logoSekolah, '', '', '', '', ''] : ['', '', '', '', '', '']);
              if (sysLogos.some(l => l && l.trim() !== '')) {
                setFormData(prev => ({ 
                  ...prev, 
                  logos: sysLogos, 
                  logoSekolah: sysLogos.find(l => l && l.trim() !== '') || data.logoSekolah || '' 
                }));
                localStorage.setItem('defaultLogos', JSON.stringify(sysLogos));
              }
              if (data.logoSekolah) {
                localStorage.setItem('defaultSchoolLogo', data.logoSekolah);
              }
            }
          }
        } catch (e) {
          // Cache miss, proceed to network
        }

        // Fetch from network to ensure it's up to date
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.senaraiGuru) {
            setSenaraiGuru(data.senaraiGuru);
          }
          if (data.coverTemplate) setGlobalCoverTemplate(data.coverTemplate);
          if (data.backCoverTemplate) setGlobalBackCoverTemplate(data.backCoverTemplate);
          if (!reportId) {
            const sysLogos: string[] = Array.isArray(data.logos) && data.logos.length > 0
              ? [...data.logos, '', '', '', '', ''].slice(0, 6)
              : (data.logoSekolah ? [data.logoSekolah, '', '', '', '', ''] : ['', '', '', '', '', '']);
            if (sysLogos.some(l => l && l.trim() !== '')) {
              setFormData(prev => ({ 
                ...prev, 
                logos: sysLogos, 
                logoSekolah: sysLogos.find(l => l && l.trim() !== '') || data.logoSekolah || '' 
              }));
              localStorage.setItem('defaultLogos', JSON.stringify(sysLogos));
            }
            if (data.logoSekolah) {
              localStorage.setItem('defaultSchoolLogo', data.logoSekolah);
            }
          }
        }
      } catch (error: any) {
        if (error?.code !== 'unavailable' && !(error?.message && error.message.toLowerCase().includes('offline'))) {
          console.error("Error fetching settings:", error);
        } else {
          console.warn("Client offline when fetching settings, relying on cache.");
        }
      }
    };
    fetchSettings();
  }, [reportId]);

  useEffect(() => {
    if (reportId) {
      const fetchReport = async () => {
        try {
          const data = await getReportWithMedia(reportId);
          if (data) {
            const reportLogos: string[] = Array.isArray(data.logos) && data.logos.length > 0
              ? [...data.logos, '', '', '', '', ''].slice(0, 6)
              : (data.logoSekolah ? [data.logoSekolah, '', '', '', '', ''] : ['', '', '', '', '', '']);
            const primaryLogo = reportLogos.find(l => l && l.trim() !== '') || data.logoSekolah || '';

            const newData = {
              namaLaporan: data.namaLaporan || '',
              namaProgram: data.namaProgram || '',
              singkatanProgram: data.singkatanProgram || '',
              tarikhPelaksanaan: data.tarikhPelaksanaan || '',
              tempat: data.tempat || '',
              sasaran: data.sasaran || '',
              objektif: data.objektif || '',
              anjuran: data.anjuran || '',
              kekuatan: data.kekuatan || '',
              perkaraPerluPenambahbaikan: data.perkaraPerluPenambahbaikan || '',
              cadanganPenambahbaikan: data.cadanganPenambahbaikan || '',
              penilaianKeberkesanan: data.penilaianKeberkesanan || '',
              disediakanOleh: data.disediakanOleh || '',
              jawatanDisediakanOleh: data.jawatanDisediakanOleh || '',
              disahkanOleh: data.disahkanOleh || '',
              jawatanDisahkanOleh: data.jawatanDisahkanOleh || '',
              gambarProgram: Array.isArray(data.gambarProgram) ? data.gambarProgram : [],
              peneranganGambar: Array.isArray(data.peneranganGambar) ? data.peneranganGambar : [],
              logos: reportLogos,
              logoSekolah: primaryLogo,
              gambarMukaDepan: data.gambarMukaDepan || '',
              gambarMukaBelakang: data.gambarMukaBelakang || '',
              logoScales: Array.isArray(data.logoScales) ? data.logoScales : [1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
            };
            setFormData(newData);
            lastSavedDataRef.current = JSON.stringify(newData);
          }
        } catch (error: any) {
          console.error("Error fetching report:", error);
        } finally {
          setLoading(false);
        }
      };
      fetchReport();
    }
  }, [reportId]);

  useEffect(() => {
    if (formData.namaProgram || formData.tarikhPelaksanaan) {
      const suggestedName = `Laporan ${formData.namaProgram} ${formData.tarikhPelaksanaan}`.trim();
      // Only auto-update if namaLaporan is empty or was previously auto-generated
      if (!formData.namaLaporan || formData.namaLaporan.startsWith('Laporan ')) {
        setFormData(prev => ({ ...prev, namaLaporan: suggestedName }));
      }
    }
  }, [formData.namaProgram, formData.tarikhPelaksanaan]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const compressBase64Image = (
    base64Str: string,
    imageType: 'logo' | 'cover' | 'program' = 'program',
    customMaxWidth?: number,
    customMaxHeight?: number,
    customQuality?: number
  ): Promise<string> => {
    const preset = imageType === 'logo'
      ? { ...COMPRESSION_PRESETS.LOGO, maxWidth: customMaxWidth || 220, maxHeight: customMaxHeight || 220, quality: customQuality || 0.85 }
      : imageType === 'cover'
      ? { ...COMPRESSION_PRESETS.COVER_PAGE, maxWidth: customMaxWidth || 640, maxHeight: customMaxHeight || 905, quality: customQuality || 0.70 }
      : { ...COMPRESSION_PRESETS.PROGRAM_PHOTO, maxWidth: customMaxWidth || 520, maxHeight: customMaxHeight || 390, quality: customQuality || 0.72 };
    return canvasCompressBase64(base64Str, preset);
  };

  const compressImage = async (file: File, imageType: 'logo' | 'cover' | 'program' = 'program'): Promise<string> => {
    const preset = imageType === 'logo'
      ? COMPRESSION_PRESETS.LOGO
      : imageType === 'cover'
      ? COMPRESSION_PRESETS.COVER_PAGE
      : COMPRESSION_PRESETS.PROGRAM_PHOTO;
    return compressImageFile(file, preset);
  };

  const handleSingleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      toast.error('Sila pilih gambar berformat JPG atau PNG sahaja.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error(`Sila pilih gambar bawah 10MB.`);
      return;
    }

    setUploadProgress(prev => ({ ...prev, [index]: 50 }));
    const toastId = toast.loading(`Memproses gambar ${index + 1}...`);
    
    try {
      const compressedDataUrl = await compressImage(file, 'program');
      
      setFormData(prev => {
        const newImages = [...prev.gambarProgram];
        while (newImages.length <= index) {
          newImages.push('');
        }
        newImages[index] = compressedDataUrl;
        return { ...prev, gambarProgram: newImages };
      });

      setUploadProgress(prev => ({ ...prev, [index]: 100 }));
      
      // Auto-generate description
      try {
        toast.loading(`Menjana penerangan gambar ${index + 1}...`, { id: toastId });
        const base64String = compressedDataUrl.split(',')[1];
        
        const description = await generateImageDescription(base64String, 'image/jpeg');
        setFormData(prev => {
          const newPenerangan = [...prev.peneranganGambar];
          while (newPenerangan.length <= index) {
            newPenerangan.push('');
          }
          newPenerangan[index] = description || `Aktiviti program ${index + 1}`;
          return { ...prev, peneranganGambar: newPenerangan };
        });
        toast.success(`Gambar & penerangan ${index + 1} berjaya ditambah!`, { id: toastId });
      } catch (err: any) {
        console.warn("Error generating description fallback:", err);
        setFormData(prev => {
          const newPenerangan = [...prev.peneranganGambar];
          while (newPenerangan.length <= index) {
            newPenerangan.push('');
          }
          newPenerangan[index] = `Aktiviti program ${index + 1}`;
          return { ...prev, peneranganGambar: newPenerangan };
        });
        toast.success(`Gambar ${index + 1} berjaya ditambah!`, { id: toastId });
      }
      
    } catch (error: any) {
      console.error("Error processing image:", error);
      toast.error("Gagal memproses gambar. Sila cuba lagi.", { id: toastId });
      // Revert preview on error
      setFormData(prev => {
        const newImages = [...prev.gambarProgram];
        newImages[index] = '';
        return { ...prev, gambarProgram: newImages };
      });
    } finally {
      setUploadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[index];
        return newProgress;
      });
      e.target.value = '';
    }
  };

  const handleOpenDrivePicker = async () => {
    try {
      const token = await requestDriveAccess();
      if (token) {
        setShowDrivePicker(true);
      } else {
        toast.error("Gagal mendapat sambungan ke Google Drive. Sila benarkan akses.");
      }
    } catch (error) {
      toast.error("Ralat bersambung ke Google Drive.");
    }
  };

  const handleDriveFilesSelected = async (fileUrls: string[]) => {
    setShowDrivePicker(false);
    if (fileUrls.length === 0) return;

    // Find available slots
    const availableIndices: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (!formData.gambarProgram[i] || formData.gambarProgram[i].trim() === '') {
        availableIndices.push(i);
      }
    }

    if (availableIndices.length === 0) {
      toast.error('Semua slot gambar telah penuh. Maksimum 6 keping gambar sahaja.');
      return;
    }

    const toastId = toast.loading('Memproses gambar...');
    const urlsToAdd = fileUrls.slice(0, availableIndices.length);
    if (fileUrls.length > availableIndices.length) {
      toast.error(`Hanya ${availableIndices.length} slot kosong. ${fileUrls.length - availableIndices.length} gambar diabaikan.`);
    }

    try {
      const compressedUrls = await Promise.all(urlsToAdd.map(url => compressBase64Image(url)));

      setFormData(prev => {
        const newImages = [...prev.gambarProgram];
        compressedUrls.forEach((url, index) => {
          const targetIndex = availableIndices[index];
          while (newImages.length <= targetIndex) {
            newImages.push('');
          }
          newImages[targetIndex] = url;
        });
        return { ...prev, gambarProgram: newImages };
      });

      toast.success(`${urlsToAdd.length} gambar berjaya ditambah.`, { id: toastId });
    } catch (error) {
      console.error("Compression error:", error);
      toast.error('Gagal memproses gambar.', { id: toastId });
    }
  };

  const processBulkFiles = async (files: File[]) => {
    if (files.length === 0) return;

    // Find available slots
    const availableIndices: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (!formData.gambarProgram[i] || formData.gambarProgram[i].trim() === '') {
        availableIndices.push(i);
      }
    }

    if (availableIndices.length === 0) {
      toast.error("Semua 6 ruangan gambar telah penuh.");
      return;
    }

    const filesToUpload = files.slice(0, availableIndices.length);
    if (files.length > availableIndices.length) {
      toast.error(`Hanya ${availableIndices.length} gambar akan dimuat naik (ruangan terhad).`);
    }

    const toastId = toast.loading(`Memproses ${filesToUpload.length} gambar...`);
    const processedImages: { index: number; dataUrl: string }[] = [];

    // Step 1: Compress and populate all images first
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      const index = availableIndices[i];

      if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
        toast.error(`Fail ${file.name} bukan berformat JPG atau PNG.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`Fail ${file.name} melebihi 10MB.`);
        continue;
      }

      setUploadProgress(prev => ({ ...prev, [index]: 50 }));

      try {
        const compressedDataUrl = await compressImage(file, 'program');
        processedImages.push({ index, dataUrl: compressedDataUrl });

        setFormData(prev => {
          const newImages = [...prev.gambarProgram];
          while (newImages.length <= index) {
            newImages.push('');
          }
          newImages[index] = compressedDataUrl;
          return { ...prev, gambarProgram: newImages };
        });

        setUploadProgress(prev => ({ ...prev, [index]: 100 }));
      } catch (error: any) {
        console.error(`Error compressing image ${index}:`, error);
        toast.error(`Gagal memproses ${file.name}.`);
      } finally {
        setUploadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[index];
          return newProgress;
        });
      }
    }

    // Step 2: Auto-generate descriptions sequentially with friendly fallback
    if (processedImages.length > 0) {
      toast.loading(`Menjana penerangan AI untuk ${processedImages.length} gambar...`, { id: toastId });
      for (let i = 0; i < processedImages.length; i++) {
        const item = processedImages[i];
        try {
          const base64String = item.dataUrl.split(',')[1];
          const description = await generateImageDescription(base64String, 'image/jpeg');

          setFormData(prev => {
            const newPenerangan = [...prev.peneranganGambar];
            while (newPenerangan.length <= item.index) {
              newPenerangan.push('');
            }
            newPenerangan[item.index] = description || `Aktiviti program ${item.index + 1}`;
            return { ...prev, peneranganGambar: newPenerangan };
          });

          // Small delay between calls to respect rate limits
          if (i < processedImages.length - 1) {
            await new Promise(r => setTimeout(r, 1200));
          }
        } catch (err: any) {
          console.warn(`Error generating bulk description for item ${item.index}:`, err);
          setFormData(prev => {
            const newPenerangan = [...prev.peneranganGambar];
            while (newPenerangan.length <= item.index) {
              newPenerangan.push('');
            }
            if (!newPenerangan[item.index]) {
              newPenerangan[item.index] = `Aktiviti program ${item.index + 1}`;
            }
            return { ...prev, peneranganGambar: newPenerangan };
          });
        }
      }
    }

    toast.success(`Selesai memproses ${filesToUpload.length} gambar!`, { id: toastId });
  };

  const handleBulkFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    await processBulkFiles(files);
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files) as File[];
    await processBulkFiles(files);
  };

  const handleAnalyzeImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      toast.error('Sila pilih gambar berformat JPG atau PNG sahaja.');
      return;
    }

    setIsAnalyzing(true);
    const toastId = toast.loading('Menganalisis gambar dengan AI...');

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const base64String = (reader.result as string).split(',')[1];
          const suggestions = await analyzeImageForReport(base64String, file.type);
          
          setAiSuggestions(suggestions);
          
          toast.success('Cadangan AI sedia untuk disemak!', { id: toastId });
        } catch (error: any) {
          console.error("Error analyzing image:", error);
          toast.error(error?.message || "Gagal menganalisis gambar.", { id: toastId });
        } finally {
          setIsAnalyzing(false);
        }
      };
    } catch (error) {
      console.error("Error reading file:", error);
      toast.error("Gagal membaca fail.", { id: toastId });
      setIsAnalyzing(false);
    } finally {
      e.target.value = '';
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        const base64 = res.includes(',') ? res.split(',')[1] : res;
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const handleExtractKertasKerja = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validExtensions = ['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png', '.webp', '.txt'];
    const fileName = file.name.toLowerCase();
    const isValid = validExtensions.some(ext => fileName.endsWith(ext)) || file.type.startsWith('image/') || file.type === 'application/pdf';

    if (!isValid) {
      toast.error('Format tidak disokong. Sila muat naik fail PDF, Word (.docx/.doc), Imej atau Teks.');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error('Saiz fail melebihi 20MB. Sila pilih fail yang lebih kecil.');
      return;
    }

    setIsExtractingKertasKerja(true);
    const toastId = toast.loading('AI sedang membaca dan mengekstrak maklumat kertas kerja...');

    try {
      const base64Data = await readFileAsBase64(file);
      const result = await extractInfoFromKertasKerja({
        fileData: base64Data,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream'
      });

      setFormData(prev => ({
        ...prev,
        namaProgram: result.namaProgram || prev.namaProgram,
        singkatanProgram: result.singkatanProgram || prev.singkatanProgram,
        namaLaporan: prev.namaLaporan || (result.namaProgram ? `Laporan - ${result.namaProgram}` : prev.namaLaporan),
        tarikhPelaksanaan: result.tarikhPelaksanaan || prev.tarikhPelaksanaan,
        tempat: result.tempat || prev.tempat,
        sasaran: result.sasaran || prev.sasaran,
        anjuran: result.anjuran || prev.anjuran,
        objektif: result.objektif || prev.objektif,
        kekuatan: result.kekuatan || prev.kekuatan,
        cadanganPenambahbaikan: result.cadanganPenambahbaikan || prev.cadanganPenambahbaikan
      }));

      setExtractedKertasKerjaSummary(result.namaProgram || file.name);
      toast.success('Maklumat Kertas Kerja berjaya diekstrak & diisi ke dalam borang!', { id: toastId });
    } catch (err: any) {
      console.error('Error extracting kertas kerja:', err);
      toast.error(err?.message || 'Gagal mengekstrak maklumat kertas kerja.', { id: toastId });
    } finally {
      setIsExtractingKertasKerja(false);
      e.target.value = '';
    }
  };

  const handleAnalyzeFeedback = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validExtensions = ['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png', '.webp', '.txt'];
    const fileName = file.name.toLowerCase();
    const isValid = validExtensions.some(ext => fileName.endsWith(ext)) || file.type.startsWith('image/') || file.type === 'application/pdf';

    if (!isValid) {
      toast.error('Format tidak disokong. Sila muat naik fail PDF, Word (.docx/.doc), Imej atau Teks.');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error('Saiz fail melebihi 20MB.');
      return;
    }

    setIsAnalyzingFeedback(true);
    const toastId = toast.loading('AI sedang menganalisis maklum balas & menjana penilaian keberkesanan...');

    try {
      const base64Data = await readFileAsBase64(file);
      const result = await analyzeFeedbackForm({
        fileData: base64Data,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        programContext: `${formData.namaProgram || ''} (${formData.tarikhPelaksanaan || ''})`
      });

      setFormData(prev => ({
        ...prev,
        penilaianKeberkesanan: result.penilaianKeberkesanan || prev.penilaianKeberkesanan,
        cadanganPenambahbaikan: result.cadanganPenambahbaikan || prev.cadanganPenambahbaikan,
        kekuatan: result.kekuatan || prev.kekuatan,
        perkaraPerluPenambahbaikan: result.perkaraPerluPenambahbaikan || prev.perkaraPerluPenambahbaikan
      }));

      setFeedbackSummary('Penilaian keberkesanan & cadangan penambahbaikan dijana mengikut respon program.');
      toast.success('Analisis Maklum Balas berjaya! Penilaian keberkesanan & cadangan telah dijana.', { id: toastId });
    } catch (err: any) {
      console.error('Error analyzing feedback:', err);
      toast.error(err?.message || 'Gagal menganalisis borang maklum balas.', { id: toastId });
    } finally {
      setIsAnalyzingFeedback(false);
      e.target.value = '';
    }
  };

  const handleGenerateSuggestion = async (field: keyof typeof formData) => {
    if (!formData.namaProgram) {
      toast.error('Sila isi Nama Program untuk mendapatkan cadangan AI.');
      return;
    }

    setGeneratingField(field);
    const toastId = toast.loading('Menjana cadangan AI...');

    try {
      const suggestion = await generateTextSuggestion(formData, field as string);
      setFormData(prev => ({ ...prev, [field]: suggestion }));
      toast.success('Cadangan AI berjaya dijana!', { id: toastId });
    } catch (error: any) {
      console.error("Error generating suggestion:", error);
      toast.error(error?.message || 'Gagal menjana cadangan. Sila cuba lagi.', { id: toastId });
    } finally {
      setGeneratingField(null);
    }
  };

  const handleGenerateImage = async () => {
    if (activeImageIndex === null || !aiPrompt) return;
    
    setIsGenerating(true);
    const toastId = toast.loading('Menjana gambar dengan AI...');
    
    try {
      const base64Image = await generateImage(aiPrompt, aiAspectRatio, aiImageSize, aiStudioQuality);
      
      const rawBase64Data = `data:image/jpeg;base64,${base64Image}`;
      const compressedDataUrl = await compressBase64Image(rawBase64Data);
      
      setFormData(prev => {
        const newImages = [...prev.gambarProgram];
        while (newImages.length <= activeImageIndex) {
          newImages.push('');
        }
        newImages[activeImageIndex] = compressedDataUrl;
        return { ...prev, gambarProgram: newImages };
      });
      
      toast.success('Gambar berjaya dijana!', { id: toastId });
      setShowGenerateModal(false);
      setAiPrompt('');
    } catch (error: any) {
      console.error("Error generating image:", error);
      toast.error(error?.message || "Gagal menjana gambar.", { id: toastId });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEditImage = async () => {
    if (activeImageIndex === null || !aiPrompt) return;
    
    const currentUrl = formData.gambarProgram[activeImageIndex];
    if (!currentUrl) return;

    setIsGenerating(true);
    const toastId = toast.loading('Menyunting gambar dengan AI...');
    
    try {
      // Fetch the current image to get it as base64
      const response = await fetch(currentUrl);
      const blob = await response.blob();
      
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      
      reader.onload = async () => {
        try {
          const base64String = (reader.result as string).split(',')[1];
          const newBase64Image = await editImage(base64String, blob.type, aiPrompt, aiStudioQuality);
          
          const rawBase64Data = `data:image/jpeg;base64,${newBase64Image}`;
          const compressedDataUrl = await compressBase64Image(rawBase64Data);
          
          setFormData(prev => {
            const newImages = [...prev.gambarProgram];
            newImages[activeImageIndex] = compressedDataUrl;
            return { ...prev, gambarProgram: newImages };
          });
          
          toast.success('Gambar berjaya disunting!', { id: toastId });
          setShowEditModal(false);
          setAiPrompt('');
        } catch (error: any) {
          console.error("Error editing image:", error);
          toast.error(error?.message || "Gagal menyunting gambar.", { id: toastId });
        } finally {
          setIsGenerating(false);
        }
      };
    } catch (error) {
      console.error("Error fetching image for edit:", error);
      toast.error("Gagal memuat turun gambar untuk disunting.", { id: toastId });
      setIsGenerating(false);
    }
  };

  const handleGenerateImageDescription = async (index: number, url: string) => {
    const toastId = toast.loading(`Menjana penerangan gambar ${index + 1}...`);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = error => reject(error);
      });

      const description = await generateImageDescription(base64String, blob.type || 'image/jpeg');
      
      setFormData(prev => {
        const newPenerangan = [...prev.peneranganGambar];
        while (newPenerangan.length <= index) {
          newPenerangan.push('');
        }
        newPenerangan[index] = description;
        return { ...prev, peneranganGambar: newPenerangan };
      });
      toast.success(`Penerangan gambar ${index + 1} berjaya dijana!`, { id: toastId });
    } catch (error: any) {
      console.error("Error generating description:", error);
      toast.error(error?.message || `Gagal menjana penerangan gambar ${index + 1}.`, { id: toastId });
    }
  };

  const removeImage = (index: number) => {
    setFormData(prev => {
      const newImages = [...prev.gambarProgram];
      newImages[index] = '';
      const newPenerangan = [...prev.peneranganGambar];
      newPenerangan[index] = '';
      return { ...prev, gambarProgram: newImages, peneranganGambar: newPenerangan };
    });
  };

  const handleFormLogoUpload = (slotIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'image/jpeg' && file.type !== 'image/png' && file.type !== 'image/webp') {
      toast.error('Sila pilih fail imej JPG, PNG atau WEBP.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Saiz gambar terlalu besar. Maksimum 5MB dibenarkan.');
      return;
    }

    setUploadingLogoSlot(slotIndex);
    const toastId = toast.loading(`Memproses Logo ${slotIndex + 1}...`);
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_WIDTH = 220;
        const MAX_HEIGHT = 220;
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const trimmedCanvas = autoTrimCanvas(canvas);
          let compressedDataUrl = '';
          try {
            const webp = trimmedCanvas.toDataURL('image/webp', 0.85);
            if (webp && webp.startsWith('data:image/webp')) {
              compressedDataUrl = webp;
            }
          } catch (e) {}
          if (!compressedDataUrl) {
            compressedDataUrl = trimmedCanvas.toDataURL('image/png');
          }
          
          setFormData(prev => {
            const nextLogos = [...(prev.logos || ['', '', '', '', '', ''])];
            nextLogos[slotIndex] = compressedDataUrl;
            return {
              ...prev,
              logos: nextLogos,
              logoSekolah: nextLogos.find(l => l && l.trim() !== '') || prev.logoSekolah || ''
            };
          });
          toast.success(`Logo ${slotIndex + 1} berjaya dikemaskini.`, { id: toastId });
        } else {
          toast.error('Gagal memproses gambar.', { id: toastId });
        }
        setUploadingLogoSlot(null);
      };
      img.onerror = () => {
        toast.error('Gagal memuat fail imej.', { id: toastId });
        setUploadingLogoSlot(null);
      };
      img.src = event.target?.result as string;
    };
    reader.onerror = () => {
      toast.error('Gagal membaca fail gambar.', { id: toastId });
      setUploadingLogoSlot(null);
    };

    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveFormLogo = (slotIndex: number) => {
    setFormData(prev => {
      const nextLogos = [...(prev.logos || ['', '', '', '', '', ''])];
      nextLogos[slotIndex] = '';
      return {
        ...prev,
        logos: nextLogos,
        logoSekolah: nextLogos.find(l => l && l.trim() !== '') || ''
      };
    });
    toast.success(`Logo ${slotIndex + 1} dipadamkan.`);
  };

  const handleMoveFormLogo = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= 6) return;
    setFormData(prev => {
      const nextLogos = [...(prev.logos || ['', '', '', '', '', ''])];
      const temp = nextLogos[fromIndex];
      nextLogos[fromIndex] = nextLogos[toIndex];
      nextLogos[toIndex] = temp;
      return {
        ...prev,
        logos: nextLogos,
        logoSekolah: nextLogos.find(l => l && l.trim() !== '') || ''
      };
    });
  };

  const handleResetToSystemLogos = async () => {
    try {
      const docRef = doc(db, 'settings', 'global');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const sysLogos = Array.isArray(data.logos) && data.logos.length > 0
          ? [...data.logos, '', '', '', '', ''].slice(0, 6)
          : (data.logoSekolah ? [data.logoSekolah, '', '', '', '', ''] : ['', '', '', '', '', '']);
        setFormData(prev => ({
          ...prev,
          logos: sysLogos,
          logoSekolah: sysLogos.find(l => l && l.trim() !== '') || data.logoSekolah || ''
        }));
        toast.success('Logo disegerak semula dari Tetapan Sistem.');
        return;
      }
    } catch (e) {
      console.warn("Could not fetch global settings, fallback to localStorage", e);
    }
    const cached = localStorage.getItem('defaultLogos');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const sysLogos = [...parsed, '', '', '', '', ''].slice(0, 6);
        setFormData(prev => ({
          ...prev,
          logos: sysLogos,
          logoSekolah: sysLogos.find(l => l && l.trim() !== '') || ''
        }));
        toast.success('Logo disegerak semula dari storan lalai.');
        return;
      } catch (e) {}
    }
    toast.error('Tiada logo lalai sistem dijumpai.');
  };

  const handleClearAllLogos = () => {
    setFormData(prev => ({
      ...prev,
      logos: ['', '', '', '', '', ''],
      logoSekolah: ''
    }));
    toast.success('Semua logo dikosongkan untuk laporan ini.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.namaProgram) {
      toast.error('Sila masukkan Nama Program untuk organisasi laporan yang lebih baik.');
      return;
    }
    
    setSaving(true);
    try {
      const validIndices = formData.gambarProgram.map((url, i) => url && url.trim() !== '' ? i : -1).filter(i => i !== -1);
      
      const uploadPromises = validIndices.map(async (i) => {
        let url = formData.gambarProgram[i];
        
        // Retroactively compress any previously uncompressed large images (e.g. > 500KB string length)
        if (url && url.length > 500000) {
          try {
             url = await compressBase64Image(url);
          } catch (e) {
             console.error("Failed to retroactively compress image", e);
          }
        }
        
        return { index: i, url };
      });
      
      toast.loading('Menyimpan gambar...', { id: 'upload-toast' });
      const uploadedImages = await Promise.all(uploadPromises);
      
      const filteredGambar = uploadedImages.map(img => img.url);
      const filteredPenerangan = uploadedImages.map(img => formData.peneranganGambar[img.index] || '');
      
      let logoFinalUrl = formData.logoSekolah;
      // Also skip storage for logo
      toast.dismiss('upload-toast');

      const reportLogos = Array.isArray(formData.logos) && formData.logos.length > 0
        ? [...formData.logos, '', '', '', '', ''].slice(0, 6)
        : (logoFinalUrl ? [logoFinalUrl, '', '', '', '', ''] : ['', '', '', '', '', '']);
      const primaryLogo = reportLogos.find(l => l && l.trim() !== '') || logoFinalUrl || '';

      const reportData = {
        ...formData,
        logos: reportLogos,
        logoSekolah: primaryLogo,
        gambarProgram: filteredGambar,
        peneranganGambar: filteredPenerangan,
        gambarMukaDepan: formData.gambarMukaDepan || '',
        gambarMukaBelakang: formData.gambarMukaBelakang || '',
        penilaianKeberkesanan: formData.penilaianKeberkesanan || '',
        updatedAt: serverTimestamp()
      };

      let docRefId = localReportId || reportId;
      if (!docRefId) {
        docRefId = doc(collection(db, 'reports')).id;
        setLocalReportId(docRefId);
        reportData.authorUid = auth.currentUser?.uid || 'guru_sk_tudan';
        reportData.authorEmail = auth.currentUser?.email || '';
        reportData.authorName = auth.currentUser?.displayName || 'Guru SK Tudan';
        reportData.createdAt = serverTimestamp();
      }

      const saveResult = await saveReportWithMedia(reportData, docRefId, auth.currentUser?.uid);
      lastSavedDataRef.current = JSON.stringify(formData);
      
      toast.success(
        reportId 
          ? `Laporan dikemas kini! (Saiz: ${saveResult.formattedSize})` 
          : `Laporan disimpan! (Saiz: ${saveResult.formattedSize})`
      );
      
      // Auto-sync to Google Drive
      const accessToken = await requestDriveAccess();
      if (accessToken) {
        toast.promise(
          (async () => {
            const folderName = `Laporan - ${reportData.namaProgram || 'Tanpa Nama'}`;
            const folderId = await createDriveFolder(accessToken, folderName);
            
            const reportHtml = `
              <h1>ONE PAGE REPORT (OPR) - ${reportData.namaProgram || 'Tanpa Nama'}</h1>
              <p><strong>Nama Laporan:</strong> <br/> ${reportData.namaLaporan}</p>
              <p><strong>Tarikh / Masa Pelaksanaan:</strong> <br/> ${reportData.tarikhPelaksanaan}</p>
              <p><strong>Sasaran:</strong> <br/> ${reportData.sasaran}</p>
              <p><strong>Anjuran:</strong> <br/> ${reportData.anjuran}</p>
              <p><strong>Objektif:</strong> <br/> ${reportData.objektif}</p>
              <p><strong>Kekuatan:</strong> <br/> ${reportData.kekuatan}</p>
              <p><strong>Perkara Yang Perlu Penambahbaikan:</strong> <br/> ${reportData.perkaraPerluPenambahbaikan}</p>
              <p><strong>Cadangan Penambahbaikan:</strong> <br/> ${reportData.cadanganPenambahbaikan}</p>
              ${reportData.penilaianKeberkesanan ? `<p><strong>Penilaian Keberkesanan:</strong> <br/> ${reportData.penilaianKeberkesanan}</p>` : ''}
              <p><strong>Disediakan Oleh:</strong> ${reportData.disediakanOleh} (${reportData.jawatanDisediakanOleh})</p>
              <p><strong>Disahkan Oleh:</strong> ${reportData.disahkanOleh} (${reportData.jawatanDisahkanOleh})</p>
            `;
            
            await uploadTextToDrive(accessToken, reportHtml, `Laporan_${reportData.namaProgram || 'Tanpa Nama'}`, folderId);
            
            if (reportData.gambarProgram.length > 0) {
              const uploadPromises = reportData.gambarProgram.map((url, index) => {
                const filename = `Gambar_${index + 1}.jpg`;
                return uploadImageToDrive(accessToken, url, filename, folderId);
              });
              await Promise.all(uploadPromises);
            }
          })(),
          {
            loading: 'Menyegerak data ke Google Drive...',
            success: 'Berjaya disegerak ke Google Drive!',
            error: (err) => err.message || 'Gagal menyegerak ke Google Drive.',
          }
        );
      }
      
      onSaved(docRefId);
    } catch (error) {
      console.error("Error saving report:", error);
      toast.error("Gagal menyimpan laporan.");
    } finally {
      setSaving(false);
    }
  };

  const renderAiSuggestion = (field: string) => {
    if (!aiSuggestions || !aiSuggestions[field]) return null;
    return (
      <div className="mt-2 p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm">
        <p className="text-purple-800 font-medium mb-1 flex items-center gap-1"><Sparkles size={14}/> Cadangan AI:</p>
        <p className="text-purple-900 mb-2 whitespace-pre-wrap">{aiSuggestions[field]}</p>
        <button 
          type="button" 
          onClick={() => { 
            setFormData(prev => ({ ...prev, [field]: aiSuggestions[field] })); 
            setAiSuggestions(prev => ({ ...prev, [field]: '' })); 
          }} 
          className="text-xs font-medium bg-purple-200 text-purple-800 px-3 py-1.5 rounded-md hover:bg-purple-300 transition-colors"
        >
          Guna Cadangan Ini
        </button>
      </div>
    );
  };

  if (loading) {
    return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="border-b border-gray-100 p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gray-50/50">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-bold text-gray-900 truncate">
            {reportId ? 'Edit Report' : 'New Report'}
          </h2>
          
          <div className="hidden sm:flex items-center gap-2 ml-4 text-sm text-gray-500 min-h-[24px]" title={lastAutoSaveTime ? `Draft saved at ${lastAutoSaveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : undefined}>
             {isAutoSaving ? (
               <>
                 <span className="relative flex h-3 w-3">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                 </span>
                 <span className="text-sm text-gray-500 font-medium">Menyimpan...</span>
               </>
             ) : lastAutoSaveTime ? (
               <>
                 <span className="relative flex h-3 w-3">
                   <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                 </span>
                 <span className="text-sm text-gray-500 font-medium hidden md:inline">Disimpan pada {lastAutoSaveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
               </>
             ) : null}
          </div>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex sm:hidden items-center gap-2 text-sm text-gray-500 min-h-[24px]" title={lastAutoSaveTime ? `Draft saved at ${lastAutoSaveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : undefined}>
             {isAutoSaving ? (
               <>
                 <span className="relative flex h-3 w-3">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                 </span>
               </>
             ) : lastAutoSaveTime ? (
               <>
                 <span className="relative flex h-3 w-3">
                   <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                 </span>
               </>
             ) : null}
          </div>
          <button
            type="button"
            onClick={() => setShowOprPreview(true)}
            className="flex items-center justify-center gap-2 px-3.5 py-2 bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white rounded-lg transition-all font-semibold text-xs sm:text-sm shadow-xs"
            title="Lihat Paparan OPR (One Page Report) secara langsung"
          >
            <Eye size={17} />
            <span>Paparan OPR</span>
          </button>
          <label className={`flex items-center justify-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg transition-colors font-medium cursor-pointer flex-1 sm:flex-initial ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {isAnalyzing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-700"></div>
            ) : (
              <Sparkles size={18} />
            )}
            <span className="hidden sm:inline">Auto-fill from Photo</span>
            <input 
              type="file" 
              accept="image/jpeg, image/png" 
              className="hidden" 
              onChange={handleAnalyzeImage}
              disabled={isAnalyzing}
            />
          </label>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6">

        {/* Bahagian Pembantu AI: Muat Naik Kertas Kerja & Borang Maklum Balas */}
        <div className="bg-gradient-to-r from-blue-50/80 via-indigo-50/70 to-purple-50/80 border border-blue-100 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-100/80 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="p-2 bg-blue-600 text-white rounded-xl shadow-xs shrink-0">
                <Sparkles size={18} />
              </span>
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  Pembantu Pintar Dokumen Program (Auto-Detect AI)
                </h3>
                <p className="text-xs text-gray-600">
                  Muat naik dokumen program anda untuk mengekstrak maklumat dan menjana laporan keberkesanan secara tepat.
                </p>
              </div>
            </div>
            {(extractedKertasKerjaSummary || feedbackSummary) && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 self-start sm:self-center">
                <CheckCircle2 size={13} /> AI Aktif
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Ruang Muat Naik Kertas Kerja */}
            <div className="bg-white/95 border border-blue-100 rounded-xl p-4 hover:border-blue-300 transition-all flex flex-col justify-between shadow-xs">
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                      <FileText size={18} />
                    </span>
                    <span className="font-semibold text-sm text-gray-900">Kertas Kerja Program</span>
                  </div>
                  <span className="text-[11px] font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">
                    PDF / Word / Imej
                  </span>
                </div>
                <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                  Ekstrak Nama Program, Tarikh, Tempat, Sasaran, Anjuran, Objektif, dan Kekuatan secara automatik daripada fail kertas kerja.
                </p>
                {extractedKertasKerjaSummary && (
                  <div className="mb-3 p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                    <span className="truncate font-medium">{extractedKertasKerjaSummary}</span>
                  </div>
                )}
              </div>

              <label className={`w-full py-2.5 px-3 border border-dashed border-blue-400 hover:border-blue-600 hover:bg-blue-50/50 rounded-lg flex items-center justify-center gap-2 text-xs font-semibold text-blue-700 cursor-pointer transition-colors ${isExtractingKertasKerja ? 'opacity-60 pointer-events-none' : ''}`}>
                {isExtractingKertasKerja ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-blue-600" />
                    <span>AI sedang membaca kertas kerja...</span>
                  </>
                ) : (
                  <>
                    <FileUp size={16} />
                    <span>{extractedKertasKerjaSummary ? 'Tukar / Muat Naik Semula Kertas Kerja' : 'Muat Naik Kertas Kerja (Auto-Detect)'}</span>
                  </>
                )}
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleExtractKertasKerja}
                  disabled={isExtractingKertasKerja}
                />
              </label>
            </div>

            {/* Ruang Muat Naik Borang Maklum Balas */}
            <div className="bg-white/95 border border-purple-100 rounded-xl p-4 hover:border-purple-300 transition-all flex flex-col justify-between shadow-xs">
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-purple-100 text-purple-700 rounded-lg">
                      <BarChart3 size={18} />
                    </span>
                    <span className="font-semibold text-sm text-gray-900">Borang Maklum Balas</span>
                  </div>
                  <span className="text-[11px] font-medium bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md">
                    PDF / Word / Imej
                  </span>
                </div>
                <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                  Analisis maklum balas responden untuk menjana Penilaian Keberkesanan yang tepat dan Cadangan Penambahbaikan mengikut program.
                </p>
                {feedbackSummary && (
                  <div className="mb-3 p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                    <span className="truncate font-medium">{feedbackSummary}</span>
                  </div>
                )}
              </div>

              <label className={`w-full py-2.5 px-3 border border-dashed border-purple-400 hover:border-purple-600 hover:bg-purple-50/50 rounded-lg flex items-center justify-center gap-2 text-xs font-semibold text-purple-700 cursor-pointer transition-colors ${isAnalyzingFeedback ? 'opacity-60 pointer-events-none' : ''}`}>
                {isAnalyzingFeedback ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-purple-600" />
                    <span>AI sedang menganalisis maklum balas...</span>
                  </>
                ) : (
                  <>
                    <FileUp size={16} />
                    <span>{feedbackSummary ? 'Tukar / Analisis Semula Maklum Balas' : 'Muat Naik Borang Maklum Balas (Auto-Jana)'}</span>
                  </>
                )}
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleAnalyzeFeedback}
                  disabled={isAnalyzingFeedback}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Tetapan Susunan Logo OPR (Logo 1 - Logo 6) */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <ImageIcon size={20} />
              </span>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Susunan Logo OPR (Logo 1 hingga Logo 6)
                </h3>
                <p className="text-xs text-gray-500">
                  Diekstrak secara automatik mengikut kedudukan. Dipaparkan seragam bersebelahan dalam fail PDF OPR.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetToSystemLogos}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1.5"
                title="Muat semula logo dari Tetapan Global Sistem"
              >
                <RefreshCw size={13} />
                Segerak Sistem
              </button>
              <button
                type="button"
                onClick={handleClearAllLogos}
                className="px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Kosongkan semua logo untuk laporan ini"
              >
                Kosongkan
              </button>
            </div>
          </div>

          {/* 6 Logo Slots Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { slot: 0, title: 'Logo 1', desc: 'PIBG' },
              { slot: 1, title: 'Logo 2', desc: 'SK Tudan' },
              { slot: 2, title: 'Logo 3', desc: 'KPM (Tengah)' },
              { slot: 3, title: 'Logo 4', desc: 'Yayasan Sarawak' },
              { slot: 4, title: 'Logo 5', desc: 'Curtin University' },
              { slot: 5, title: 'Logo 6', desc: 'Tambahan (Pilihan)' },
            ].map(({ slot, title, desc }) => {
              const currentLogo = formData.logos?.[slot] || '';
              const isUploading = uploadingLogoSlot === slot;

              return (
                <div key={slot} className="bg-gray-50/70 border border-gray-200 rounded-lg p-2.5 flex flex-col items-center justify-between text-center relative group hover:border-blue-300 transition-all">
                  {/* Slot Header Badge & Controls */}
                  <div className="w-full flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                      {title}
                    </span>
                    
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleMoveFormLogo(slot, slot - 1)}
                        disabled={slot === 0}
                        title="Alih ke Kiri"
                        className="p-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-20 rounded"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveFormLogo(slot, slot + 1)}
                        disabled={slot === 5}
                        title="Alih ke Kanan"
                        className="p-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-20 rounded"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Logo Preview Square */}
                  <div className="w-full h-20 border border-dashed border-gray-300 rounded bg-white flex items-center justify-center relative overflow-hidden mb-1.5">
                    {currentLogo ? (
                      <img 
                        src={currentLogo} 
                        alt={title} 
                        className="w-full h-full object-contain p-1" 
                      />
                    ) : (
                      <div className="text-gray-300 flex flex-col items-center justify-center">
                        <Upload size={16} className="mb-0.5 opacity-50" />
                        <span className="text-[10px]">Kosong</span>
                      </div>
                    )}

                    {isUploading && (
                      <div className="absolute inset-0 bg-white/90 flex items-center justify-center flex-col">
                        <Loader2 size={18} className="animate-spin text-blue-600" />
                        <span className="text-[9px] font-semibold text-blue-600">Memproses...</span>
                      </div>
                    )}
                  </div>

                  <p className="text-[10px] text-gray-500 font-medium truncate w-full mb-1.5" title={desc}>
                    {desc}
                  </p>

                  {/* Logo Scale Adjuster */}
                  {currentLogo && (
                    <div className="w-full flex items-center justify-between bg-white border border-gray-200 rounded px-1.5 py-0.5 mb-1.5 shadow-2xs">
                      <span className="text-[10px] text-gray-500 font-medium">Saiz:</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleAdjustLogoScale(slot, -0.1)}
                          title="Kecilkan logo"
                          className="w-4 h-4 flex items-center justify-center text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                        >
                          -
                        </button>
                        <span className="text-[10px] font-bold text-blue-700 min-w-[26px]">
                          {((formData.logoScales?.[slot] || 1.0)).toFixed(1)}x
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAdjustLogoScale(slot, 0.1)}
                          title="Besarkan logo"
                          className="w-4 h-4 flex items-center justify-center text-[11px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 rounded transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="w-full flex items-center gap-1 mt-auto">
                    <input 
                      type="file" 
                      ref={el => formLogoInputRefs.current[slot] = el}
                      className="hidden" 
                      accept="image/jpeg,image/png,image/webp" 
                      onChange={(e) => handleFormLogoUpload(slot, e)}
                    />
                    <button 
                      type="button"
                      onClick={() => formLogoInputRefs.current[slot]?.click()}
                      disabled={isUploading}
                      className="flex-1 bg-white hover:bg-blue-50 border border-gray-200 text-blue-700 text-[11px] py-1 px-1.5 rounded font-medium transition-colors flex items-center justify-center gap-1"
                    >
                      <Upload size={10} />
                      {currentLogo ? 'Tukar' : 'Upload'}
                    </button>
                    {currentLogo && (
                      <button 
                        type="button"
                        onClick={() => handleRemoveFormLogo(slot)}
                        disabled={isUploading}
                        title="Padam logo ini"
                        className="text-red-500 hover:bg-red-50 p-1 rounded transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Preview Strip */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Eye size={14} className="text-blue-600" />
                Pratonton Lorong Logo OPR (Cetak / PDF)
              </span>
              <span className="text-[11px] text-slate-500">
                {(formData.logos || []).filter(l => l && l.trim() !== '').length} logo aktif
              </span>
            </div>
            
            <div className="bg-white border border-gray-200 rounded p-2.5 min-h-[64px] flex items-center justify-center overflow-x-auto">
              {(formData.logos || []).some(l => l && l.trim() !== '') ? (
                <div className="flex flex-row items-center justify-center gap-4 sm:gap-6 flex-wrap w-full">
                  {(formData.logos || []).map((logo, idx) => {
                    if (!logo || logo.trim() === '') return null;
                    return (
                      <img 
                        key={idx}
                        src={logo} 
                        alt={`Logo ${idx + 1}`} 
                        className="object-contain inline-block"
                        style={{ 
                          height: '60px', 
                          maxHeight: '60px', 
                          width: 'auto', 
                          maxWidth: '160px',
                          imageRendering: '-webkit-optimize-contrast',
                          verticalAlign: 'middle'
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                <span className="text-xs text-gray-400">
                  Tiada logo dimuatkan. Klik "Segerak Sistem" atau muat naik logo di atas.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1 md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Nama Laporan (Auto-cadangan)</label>
            <input 
              type="text" 
              name="namaLaporan" 
              value={formData.namaLaporan} 
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-gray-50"
              placeholder="Contoh: Laporan Perkhemahan Perdana 2024"
            />
            <p className="text-xs text-gray-500">Nama ini akan digunakan sebagai tajuk fail PDF dan paparan di halaman utama.</p>
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Nama Program <span className="text-red-500">*</span></label>
            <input 
              required
              type="text" 
              name="namaProgram" 
              value={formData.namaProgram} 
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="e.g. Kem Jati Diri"
            />
            {renderAiSuggestion('namaProgram')}
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Tarikh Pelaksanaan <span className="text-red-500">*</span></label>
            <input 
              required
              type="text" 
              name="tarikhPelaksanaan" 
              value={formData.tarikhPelaksanaan} 
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="e.g. 12 - 14 Mei 2026"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Tempat</label>
            <input 
              type="text" 
              name="tempat" 
              value={formData.tempat} 
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="e.g. Dewan Sekolah"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Sasaran</label>
            <input 
              type="text" 
              name="sasaran" 
              value={formData.sasaran} 
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="e.g. Murid Tahun 6"
            />
            {renderAiSuggestion('sasaran')}
          </div>

          <div className="space-y-1 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Objektif</label>
              <button
                type="button"
                onClick={() => handleGenerateSuggestion('objektif')}
                disabled={generatingField === 'objektif'}
                className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50"
              >
                <Sparkles size={12} />
                {generatingField === 'objektif' ? 'Menjana...' : 'Jana Cadangan AI'}
              </button>
            </div>
            <textarea 
              name="objektif" 
              value={formData.objektif} 
              onChange={handleChange}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none text-justify"
            />
            {renderAiSuggestion('objektif')}
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Anjuran</label>
            <input 
              type="text" 
              name="anjuran" 
              value={formData.anjuran} 
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="e.g. Panitia Matematik"
            />
            {renderAiSuggestion('anjuran')}
          </div>
        </div>
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Singkatan Program (Pilihan, paparan di muka depan)
            </label>
            <input
              type="text"
              name="singkatanProgram"
              value={formData.singkatanProgram || ''}
              onChange={handleChange}
              className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500"
              placeholder="Cth: KMD"
            />
          </div>

        <div className="pt-6 border-t border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Penilaian Keberkesanan Program</h3>
          
          <div className="space-y-6">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Kekuatan (a, b, c...)</label>
                <button
                  type="button"
                  onClick={() => handleGenerateSuggestion('kekuatan')}
                  disabled={generatingField === 'kekuatan'}
                  className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {generatingField === 'kekuatan' ? 'Menjana...' : 'Jana Cadangan AI'}
                </button>
              </div>
              <textarea 
                name="kekuatan" 
                value={formData.kekuatan} 
                onChange={handleChange}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none text-justify"
                placeholder="a) ...&#10;b) ...&#10;c) ..."
              />
              {renderAiSuggestion('kekuatan')}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Perkara Perlu Penambahbaikan (a, b, c...)</label>
                <button
                  type="button"
                  onClick={() => handleGenerateSuggestion('perkaraPerluPenambahbaikan')}
                  disabled={generatingField === 'perkaraPerluPenambahbaikan'}
                  className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {generatingField === 'perkaraPerluPenambahbaikan' ? 'Menjana...' : 'Jana Cadangan AI'}
                </button>
              </div>
              <textarea 
                name="perkaraPerluPenambahbaikan" 
                value={formData.perkaraPerluPenambahbaikan} 
                onChange={handleChange}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none text-justify"
                placeholder="a) ...&#10;b) ...&#10;c) ..."
              />
              {renderAiSuggestion('perkaraPerluPenambahbaikan')}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Cadangan Penambahbaikan</label>
                <button
                  type="button"
                  onClick={() => handleGenerateSuggestion('cadanganPenambahbaikan')}
                  disabled={generatingField === 'cadanganPenambahbaikan'}
                  className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {generatingField === 'cadanganPenambahbaikan' ? 'Menjana...' : 'Jana Cadangan AI'}
                </button>
              </div>
              <textarea 
                name="cadanganPenambahbaikan" 
                value={formData.cadanganPenambahbaikan} 
                onChange={handleChange}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none text-justify"
                placeholder="Cadangan dibuat berdasarkan perkara yang perlu penambahbaikan."
              />
              {renderAiSuggestion('cadanganPenambahbaikan')}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Penilaian Keberkesanan Program</label>
                <button
                  type="button"
                  onClick={() => handleGenerateSuggestion('penilaianKeberkesanan')}
                  disabled={generatingField === 'penilaianKeberkesanan'}
                  className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {generatingField === 'penilaianKeberkesanan' ? 'Menjana...' : 'Jana Cadangan AI'}
                </button>
              </div>
              <textarea 
                name="penilaianKeberkesanan" 
                value={formData.penilaianKeberkesanan} 
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none text-justify"
                placeholder="Contoh: 95% peserta menyatakan objektif program tercapai dengan jayanya dan memberi impak tinggi."
              />
              {renderAiSuggestion('penilaianKeberkesanan')}
            </div>
          </div>
        </div>

        {/* Bahagian Muka Depan & Muka Belakang (Satu Set OPR Lengkap) */}
        <div className="pt-6 border-t border-gray-100 mb-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Muka Hadapan & Muka Belakang (Cover Pages)</h3>
            <p className="text-sm text-gray-500">Muat naik gambar muka depan dan belakang untuk menghasilkan satu set dokumentasi OPR yang lengkap (Cover Depan + OPR + Cover Belakang).</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Cover Depan */}
            <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">1. Gambar Muka Depan (Cover Hadapan)</h4>
                  <p className="text-xs text-gray-500">
                    {formData.gambarMukaDepan 
                      ? 'Cover khusus bagi laporan ini dimuat naik.' 
                      : (globalCoverTemplate 
                        ? 'Menggunakan templat rasmi sekolah secara automatik.' 
                        : 'Dijana secara automatik oleh sistem.')}
                  </p>
                </div>
                {formData.gambarMukaDepan && (
                  <button 
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, gambarMukaDepan: '' }))}
                    className="text-red-500 hover:text-red-700 text-xs font-medium px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                  >
                    Guna Templat Asal
                  </button>
                )}
              </div>
              
              {/* Preview Container dengan Ruang Kosong Auto-Ekstrak */}
              {(() => {
                const effectiveCover = formData.gambarMukaDepan || globalCoverTemplate;
                const formLogos = Array.isArray(formData.logos) && formData.logos.some(l => l && l.trim() !== '')
                  ? formData.logos.filter(l => l && l.trim() !== '')
                  : (formData.logoSekolah ? [formData.logoSekolah] : []);

                return (
                  <div className="space-y-2">
                    <div className="w-full aspect-[1/1.414] max-h-[380px] mx-auto border-2 border-gray-200 rounded-xl relative overflow-hidden bg-white shadow-xs flex items-center justify-center">
                      {effectiveCover ? (
                        <div className="relative w-full h-full">
                          <img src={effectiveCover} alt="Cover Depan" className="w-full h-full object-cover" />
                          
                          {/* Logo Baris Atas Mengikut Urutan Sistem */}
                          {formLogos.length > 0 && (
                            <div 
                              className="absolute left-0 right-0 z-20 flex flex-row items-center justify-center flex-nowrap px-3 overflow-visible pointer-events-none" 
                              style={{ 
                                top: '4.8%', 
                                width: '100%',
                                height: '36px',
                                gap: formLogos.length > 4 ? '12px' : '16px'
                              }}
                            >
                              {formLogos.map((l: string, idx: number) => {
                                const isKpm = idx === 2 || l.toLowerCase().includes('kpm') || l.toLowerCase().includes('kementerian') || l.toLowerCase().includes('pendidikan');
                                const isYayasan = idx === 3 || l.toLowerCase().includes('yayasan') || l.toLowerCase().includes('sarawak');
                                const isCurtin = idx === 4 || l.toLowerCase().includes('curtin');
                                const s = formData.logoScales?.[idx] || 1.0;

                                const baseH = isCurtin ? 16 : (isKpm ? 28 : (isYayasan ? 25 : 27));
                                const maxW = isCurtin ? 58 : (isKpm || isYayasan ? 38 : 35);
                                const finalH = Math.round(baseH * s);
                                const finalMaxW = Math.round(maxW * s);

                                return (
                                  <div
                                    key={idx}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      height: `${finalH}px`,
                                      maxWidth: `${finalMaxW}px`,
                                      flexShrink: 0
                                    }}
                                  >
                                    <img 
                                      src={l} 
                                      alt={`Logo ${idx + 1}`} 
                                      style={{ 
                                        height: `${finalH}px`, 
                                        maxHeight: `${finalH}px`, 
                                        width: 'auto', 
                                        maxWidth: `${finalMaxW}px`, 
                                        objectFit: 'contain'
                                      }} 
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Ruang Kosong: 1. Tajuk Program - Tepat di tengah ruang putih kotak Tajuk Program dalam 2 baris seimbang */}
                          <div 
                            className="absolute z-10 flex items-center justify-center px-2 pointer-events-none" 
                            style={{ 
                              top: '47.6%', 
                              left: '34.5%', 
                              width: '60.0%', 
                              height: '6.4%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxSizing: 'border-box',
                              textAlign: 'center'
                            }}
                          >
                            <p 
                              className="font-bold text-black border-none bg-transparent m-0 leading-snug text-center uppercase line-clamp-2 w-full tracking-normal" 
                              style={{ fontSize: (formData.namaProgram || formData.namaLaporan || '').length > 40 ? '8.5pt' : '9.5pt', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', color: '#000000', lineHeight: 1.25, textAlign: 'center' }}
                            >
                              {(formData.namaProgram || formData.singkatanProgram || formData.namaLaporan || '(Nama Program Diekstrak)').toUpperCase()}
                            </p>
                          </div>

                          {/* Ruang Kosong: 2. Tarikh - Tepat di tengah ruang putih kotak Tarikh secara mendatar & menegak */}
                          <div 
                            className="absolute z-10 flex items-center justify-center px-2 pointer-events-none" 
                            style={{ 
                              top: '56.8%', 
                              left: '34.5%', 
                              width: '60.0%', 
                              height: '6.4%',
                              textAlign: 'center',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxSizing: 'border-box'
                            }}
                          >
                            <p 
                              className="font-bold text-black border-none bg-transparent m-0 leading-tight text-center w-full uppercase" 
                              style={{ fontSize: '10pt', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', color: '#000000', lineHeight: 1.2, textAlign: 'center' }}
                            >
                              {(formData.tarikhPelaksanaan || '(Tarikh Pelaksanaan Diekstrak)').toUpperCase()}
                            </p>
                          </div>

                          {/* Ruang Kosong: 3. Tempat - Tepat di tengah ruang putih kotak Tempat secara mendatar & menegak */}
                          <div 
                            className="absolute z-10 flex items-center justify-center px-2 pointer-events-none" 
                            style={{ 
                              top: '66.0%', 
                              left: '34.5%', 
                              width: '60.0%', 
                              height: '6.4%',
                              textAlign: 'center',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxSizing: 'border-box'
                            }}
                          >
                            <p 
                              className="font-bold text-black border-none bg-transparent m-0 leading-tight text-center line-clamp-2 w-full uppercase" 
                              style={{ fontSize: '10pt', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', color: '#000000', lineHeight: 1.2, textAlign: 'center' }}
                            >
                              {(formData.tempat || '(Tempat Pelaksanaan Diekstrak)').toUpperCase()}
                            </p>
                          </div>

                          {/* Ruang Kosong Bawah Sekali Sebelah Kiri: QR Code Diturunkan ke Bawah Sekali Supaya Tidak Bertindih */}
                          <div 
                            className="absolute z-20 flex items-center justify-start pointer-events-auto" 
                            style={{ 
                              bottom: '0.4%', 
                              left: '1.5%', 
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start'
                            }}
                          >
                            <CoverQrBadge 
                              reportId={localReportId || reportId}
                              namaProgram={formData.namaProgram || formData.singkatanProgram || formData.namaLaporan}
                              compact={true}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full p-4 flex flex-col justify-between items-center text-center bg-white">
                          {formLogos.length > 0 && (
                            <div className="flex gap-2 justify-center items-center">
                              {formLogos.slice(0, 3).map((l: string, idx: number) => (
                                <img key={idx} src={l} alt="Logo" className="h-6 w-auto object-contain" />
                              ))}
                            </div>
                          )}
                          <div>
                            <span className="text-[10px] font-bold text-blue-700 tracking-wider uppercase">ONE PAGE REPORT (OPR)</span>
                            <h5 className="text-[10px] font-bold text-gray-900 uppercase">SEKOLAH KEBANGSAAN TUDAN, MIRI</h5>
                            <p className="text-[9px] font-semibold text-gray-700 mt-1 uppercase line-clamp-2">
                              {formData.namaProgram || formData.namaLaporan || '(Nama Program)'}
                            </p>
                          </div>
                          <div className="w-full bg-blue-50/60 border border-blue-200 rounded p-1.5 text-[8px] text-left space-y-0.5">
                            <div><strong className="text-blue-900">Program:</strong> {formData.namaProgram || '-'}</div>
                            <div><strong className="text-blue-900">Tarikh:</strong> {formData.tarikhPelaksanaan || '-'}</div>
                            <div><strong className="text-blue-900">Tempat:</strong> {formData.tempat || '-'}</div>
                          </div>
                          <div className="w-full flex justify-center mt-1">
                            <CoverQrBadge 
                              reportId={localReportId || reportId}
                              namaProgram={formData.namaProgram || formData.singkatanProgram || formData.namaLaporan}
                              compact={true}
                            />
                          </div>
                          <p className="text-[9px] text-gray-400 italic">Muka depan rasmi dijana automatik</p>
                        </div>
                      )}
                    </div>

                    <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-2.5 text-xs text-blue-900 flex items-start gap-2">
                      <span className="text-blue-600 font-bold shrink-0">✓</span>
                      <p className="leading-snug text-[11px]">
                        <strong>Auto-Ekstrak & QR Code:</strong> Maklumat <strong>Nama Program</strong>, <strong>Tarikh</strong>, <strong>Tempat</strong>, serta <strong>QR Code & Pautan Digital OPR</strong> dijana secara automatik dan diletakkan di ruang bawah muka depan.
                      </p>
                    </div>

                    <div className="relative">
                      <button
                        type="button"
                        className="w-full py-2 px-3 border border-gray-300 hover:border-blue-500 rounded-lg text-xs font-semibold text-gray-700 hover:text-blue-600 bg-white hover:bg-blue-50/30 transition-colors flex items-center justify-center gap-2"
                      >
                        <Upload size={14} />
                        <span>{formData.gambarMukaDepan ? 'Tukar Gambar Muka Depan Khusus' : 'Muat Naik Gambar Muka Depan Tersuai (Pilihan)'}</span>
                      </button>
                      <input 
                        type="file" 
                        accept="image/jpeg, image/png" 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
                            toast.error('Guna JPG atau PNG sahaja.');
                            return;
                          }
                          if (file.size > 5 * 1024 * 1024) {
                            toast.error('Saiz bawah 5MB.');
                            return;
                          }
                          
                          const toastId = toast.loading('Memproses muka depan...');
                          try {
                            const dataUrl = await compressImage(file, 'cover');
                            setFormData(prev => ({ ...prev, gambarMukaDepan: dataUrl }));
                            toast.success('Muka depan berjaya dimuat naik!', { id: toastId });
                          } catch (e) {
                            toast.error('Gagal memproses gambar.', { id: toastId });
                          }
                          e.target.value = '';
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Cover Belakang */}
            <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">2. Gambar Muka Belakang (Cover Belakang)</h4>
                  <p className="text-xs text-gray-500">
                    {formData.gambarMukaBelakang 
                      ? 'Cover belakang khusus bagi laporan ini.' 
                      : (globalBackCoverTemplate 
                        ? 'Menggunakan templat belakang rasmi sekolah.' 
                        : 'Muka belakang rasmi dijana automatik oleh sistem.')}
                  </p>
                </div>
                {formData.gambarMukaBelakang && (
                  <button 
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, gambarMukaBelakang: '' }))}
                    className="text-red-500 hover:text-red-700 text-xs font-medium px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                  >
                    Guna Templat Asal
                  </button>
                )}
              </div>
              
              {(() => {
                const effectiveBackCover = formData.gambarMukaBelakang || globalBackCoverTemplate;

                return (
                  <div className="space-y-2">
                    <div className="w-full aspect-[1/1.414] max-h-[380px] mx-auto border-2 border-gray-200 rounded-xl relative overflow-hidden bg-white shadow-xs flex items-center justify-center">
                      {effectiveBackCover ? (
                        <img src={effectiveBackCover} alt="Cover Belakang" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full p-4 flex flex-col justify-between items-center text-center bg-white">
                          <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase">DOKUMEN DOKUMENTASI RASMI</span>
                          <div className="flex flex-col items-center">
                            <div className="w-12 h-12 rounded-full border-2 border-dashed border-blue-300 flex items-center justify-center text-blue-500 font-bold text-xs mb-1">
                              OPR
                            </div>
                            <h5 className="text-[10px] font-bold text-gray-900 uppercase">SEKOLAH KEBANGSAAN TUDAN, MIRI</h5>
                            <p className="text-[8px] text-gray-500 italic mt-0.5">SHINE TUDAN SHINE</p>
                          </div>
                          <p className="text-[9px] text-gray-400 italic">Muka belakang rasmi dijana automatik</p>
                        </div>
                      )}
                    </div>

                    <div className="relative">
                      <button
                        type="button"
                        className="w-full py-2 px-3 border border-gray-300 hover:border-blue-500 rounded-lg text-xs font-semibold text-gray-700 hover:text-blue-600 bg-white hover:bg-blue-50/30 transition-colors flex items-center justify-center gap-2"
                      >
                        <Upload size={14} />
                        <span>{formData.gambarMukaBelakang ? 'Tukar Gambar Muka Belakang' : 'Muat Naik Gambar Muka Belakang Tersuai (Pilihan)'}</span>
                      </button>
                      <input 
                        type="file" 
                        accept="image/jpeg, image/png" 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
                            toast.error('Guna JPG atau PNG sahaja.');
                            return;
                          }
                          if (file.size > 5 * 1024 * 1024) {
                            toast.error('Saiz bawah 5MB.');
                            return;
                          }
                          
                          const toastId = toast.loading('Memproses muka belakang...');
                          try {
                            const dataUrl = await compressImage(file, 'cover');
                            setFormData(prev => ({ ...prev, gambarMukaBelakang: dataUrl }));
                            toast.success('Muka belakang berjaya dimuat naik!', { id: toastId });
                          } catch (e) {
                            toast.error('Gagal memproses gambar.', { id: toastId });
                          }
                          e.target.value = '';
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        <div 
          className={`pt-6 border-t border-gray-100 transition-colors ${
            isDraggingOver ? 'bg-blue-50/50 outline-dashed outline-2 outline-blue-400 outline-offset-4 rounded-xl -m-2 p-2' : ''
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Gambar Program</h3>
              <p className="text-sm text-gray-500">Sila muat naik gambar (Maksimum 6 keping). Anda juga boleh tarik dan lepas (drag & drop) gambar ke kawasan ini.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 hidden sm:inline">
                {formData.gambarProgram.filter(url => url && url.trim() !== '').length} / 6 gambar
              </span>
              <button
                type="button"
                onClick={handleOpenDrivePicker}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg cursor-pointer transition-colors text-sm font-medium"
              >
                <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" className="w-4 h-4" />
                <span className="hidden sm:inline">Google Drive</span>
                <span className="sm:hidden">Drive</span>
              </button>
              <label className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg cursor-pointer transition-colors text-sm font-medium">
                <Upload size={16} />
                <span className="hidden sm:inline">Muat Naik Pukal</span>
                <span className="sm:hidden">Pukal</span>
                <input 
                  type="file" 
                  multiple 
                  accept="image/jpeg, image/png" 
                  className="hidden" 
                  onChange={handleBulkFileSelect} 
                />
              </label>
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((index) => {
              const url = formData.gambarProgram[index];
              const isUploading = uploadProgress.hasOwnProperty(index);
              const progress = Math.round(uploadProgress[index] || 0);

              return (
                <div key={index} className="flex flex-col gap-2">
                  <div className="relative aspect-video bg-gray-50 rounded-xl overflow-hidden border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors">
                    {url && url.trim() !== '' ? (
                      <div className="w-full h-full group relative bg-white">
                        <img src={url} alt={`Gambar ${index + 1}`} className="w-full h-full object-contain" />
                        
                        {isUploading && (
                          <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center">
                            <div className="relative flex items-center justify-center mb-2">
                              <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <span className="absolute text-[10px] font-bold text-blue-800">{Math.round(progress)}%</span>
                            </div>
                            <span className="text-xs font-medium text-blue-800">Memuat naik...</span>
                          </div>
                        )}

                        {!isUploading && (
                          <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              type="button"
                              onClick={() => {
                                setActiveImageIndex(index);
                                setAiPrompt('');
                                setShowEditModal(true);
                              }}
                              className="p-1.5 bg-purple-600 text-white rounded-full shadow-sm hover:bg-purple-700"
                              title="Edit with AI"
                            >
                              <Wand2 size={14} />
                            </button>
                            <button 
                              type="button"
                              onClick={() => removeImage(index)}
                              className="p-1.5 bg-red-600 text-white rounded-full shadow-sm hover:bg-red-700"
                              title="Remove Image"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center w-full h-full">
                        <label className={`flex flex-col items-center justify-center w-full h-full cursor-pointer ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <input
                            type="file"
                            accept="image/jpeg, image/png"
                            onChange={(e) => handleSingleFileSelect(e, index)}
                            className="hidden"
                            disabled={isUploading}
                          />
                          {isUploading ? (
                            <div className="flex flex-col items-center text-blue-600">
                              <div className="relative flex items-center justify-center mb-2">
                                <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span className="absolute text-[10px] font-bold text-blue-700">{progress}%</span>
                              </div>
                              <span className="text-xs font-medium">Memuat naik...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center text-gray-400 hover:text-blue-500">
                              <Upload size={24} className="mb-1" />
                              <span className="text-xs font-medium text-center px-2">Muat Naik</span>
                            </div>
                          )}
                        </label>
                        
                        {!isUploading && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveImageIndex(index);
                              setAiPrompt('');
                              setShowGenerateModal(true);
                            }}
                            className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-full text-xs font-medium transition-colors"
                          >
                            <ImagePlus size={12} />
                            Jana AI
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {url && url.trim() !== '' && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Penerangan gambar (pilihan)"
                        value={formData.peneranganGambar[index] || ''}
                        onChange={(e) => {
                          const newPenerangan = [...formData.peneranganGambar];
                          newPenerangan[index] = e.target.value;
                          setFormData({ ...formData, peneranganGambar: newPenerangan });
                        }}
                        className="flex-1 text-sm p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleGenerateImageDescription(index, url)}
                        className="px-3 py-2 bg-purple-50 text-purple-600 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors flex items-center justify-center"
                        title="Jana Penerangan Auto"
                      >
                        <Sparkles size={16} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-6 border-t border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Tandatangan</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <TeacherCombobox
              label="Disediakan oleh:"
              value={formData.disediakanOleh}
              jawatan={formData.jawatanDisediakanOleh}
              onChange={(nama, jawatan) => setFormData(prev => ({ ...prev, disediakanOleh: nama, jawatanDisediakanOleh: jawatan }))}
              teachers={senaraiGuru}
            />

            <TeacherCombobox
              label="Disahkan oleh:"
              value={formData.disahkanOleh}
              jawatan={formData.jawatanDisahkanOleh}
              onChange={(nama, jawatan) => setFormData(prev => ({ ...prev, disahkanOleh: nama, jawatanDisahkanOleh: jawatan }))}
              teachers={senaraiGuru}
            />
          </div>
        </div>

        <div className="pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => setShowOprPreview(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white rounded-xl transition-all font-semibold text-sm shadow-xs"
              title="Lihat bagaimana laporan ini dipaparkan dalam format OPR"
            >
              <Eye size={18} />
              <span>Paparan OPR (One Page Report)</span>
            </button>
          </div>
          <div className="flex justify-end gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white hover:bg-blue-700 rounded-xl transition-colors font-medium disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {saving ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <Save size={20} />
              )}
              {saving ? 'Saving...' : 'Save Report'}
            </button>
          </div>
        </div>
      </form>

      {/* Generate Image Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-purple-50/50">
              <h3 className="font-bold text-purple-900 flex items-center gap-2">
                <ImagePlus size={20} className="text-purple-600" />
                Jana Gambar AI
              </h3>
              <button onClick={() => setShowGenerateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Prompt / Arahan</label>
                <textarea 
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Murid-murid sedang membaca buku di perpustakaan sekolah dengan gembira..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none resize-none"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Nisbah Aspek (Aspect Ratio)</label>
                <select 
                  value={aiAspectRatio}
                  onChange={(e) => setAiAspectRatio(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                >
                  <option value="1:1">1:1 (Square)</option>
                  <option value="2:3">2:3 (Portrait)</option>
                  <option value="3:2">3:2 (Landscape)</option>
                  <option value="3:4">3:4 (Portrait)</option>
                  <option value="4:3">4:3 (Standard)</option>
                  <option value="9:16">9:16 (Vertical)</option>
                  <option value="16:9">16:9 (Widescreen)</option>
                  <option value="21:9">21:9 (Cinematic)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Resolusi (Image Size)</label>
                <select 
                  value={aiImageSize}
                  onChange={(e) => setAiImageSize(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                >
                  <option value="512px">512px (Pantas)</option>
                  <option value="1K">1K (Standard)</option>
                  <option value="2K">2K (Tinggi)</option>
                  <option value="4K">4K (Ultra HD)</option>
                </select>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input 
                  type="checkbox" 
                  id="studioQualityGenerate" 
                  checked={aiStudioQuality}
                  onChange={(e) => setAiStudioQuality(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                />
                <label htmlFor="studioQualityGenerate" className="text-sm font-medium text-gray-700">
                  Kualiti Studio (Pro Model)
                </label>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button 
                onClick={() => setShowGenerateModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Batal
              </button>
              <button 
                onClick={handleGenerateImage}
                disabled={isGenerating || !aiPrompt.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white hover:bg-purple-700 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isGenerating ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Sparkles size={16} />
                )}
                Jana Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Image Modal */}
      {showDrivePicker && (
        <GoogleDriveImagePicker
          onClose={() => setShowDrivePicker(false)}
          onSelectFiles={handleDriveFilesSelected}
          maxFiles={6 - formData.gambarProgram.filter(url => url && url.trim() !== '').length}
        />
      )}

      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-purple-50/50">
              <h3 className="font-bold text-purple-900 flex items-center gap-2">
                <Wand2 size={20} className="text-purple-600" />
                Sunting Gambar AI
              </h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden mb-4">
                <img src={formData.gambarProgram[activeImageIndex!]} alt="Current" className="w-full h-full object-contain" />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Prompt / Arahan Suntingan</label>
                <textarea 
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Jadikan gambar lebih cerah, tambah belon di latar belakang..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none resize-none"
                />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input 
                  type="checkbox" 
                  id="studioQualityEdit" 
                  checked={aiStudioQuality}
                  onChange={(e) => setAiStudioQuality(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                />
                <label htmlFor="studioQualityEdit" className="text-sm font-medium text-gray-700">
                  Kualiti Studio (Pro Model)
                </label>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button 
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Batal
              </button>
              <button 
                onClick={handleEditImage}
                disabled={isGenerating || !aiPrompt.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white hover:bg-purple-700 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isGenerating ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Sparkles size={16} />
                )}
                Sunting Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Paparan OPR (Live Preview) */}
      {showOprPreview && (
        <div className="fixed inset-0 z-[80] bg-gray-900/80 backdrop-blur-sm overflow-y-auto p-2 sm:p-6 flex justify-center">
          <div className="relative w-full max-w-[950px] bg-white shadow-2xl rounded-xl my-auto flex flex-col max-h-[92vh] overflow-hidden">
            <div className="sticky top-0 z-20 bg-gray-100 border-b border-gray-200 px-4 py-3 sm:px-6 flex justify-between items-center shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="p-1.5 bg-blue-600 text-white rounded-lg">
                  <FileText size={18} />
                </span>
                <div>
                  <h3 className="font-bold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                    Pratonton Paparan OPR (One Page Report)
                  </h3>
                  <p className="text-[11px] text-gray-500">Paparan langsung susunan jadual dan logo laporan anda</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowOprPreview(false)}
                  className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Content OPR */}
            <div className="overflow-y-auto bg-gray-200/70 p-3 sm:p-6 flex justify-center">
              <div className="bg-white shadow-md w-full max-w-[210mm] pt-3 px-4 pb-4 sm:pt-4 sm:px-6 sm:pb-6 text-black border border-gray-200 rounded-sm" style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11pt', lineHeight: 1.5 }}>
                
                {/* Tajuk Rasmi OPR - Dinaikkan ke atas sepenuhnya */}
                <div className="text-center mt-0 mb-2 border-b border-gray-200 pb-1.5">
                  <h2 className="text-base sm:text-lg font-bold uppercase tracking-wider text-black m-0" style={{ letterSpacing: '0.05em', lineHeight: 1.1 }}>
                    ONE PAGE REPORT (OPR)
                  </h2>
                  <p className="text-xs sm:text-sm font-semibold uppercase text-gray-700 m-0" style={{ lineHeight: 1.2 }}>
                    SEKOLAH KEBANGSAAN TUDAN, MIRI
                  </p>
                </div>

                {/* Jadual OPR */}
                <table className="w-full border-collapse border border-black mb-3" style={{ fontSize: '11pt', lineHeight: 1.15 }}>
                  <thead>
                    <tr>
                      <th className="border border-black p-1 bg-gray-100 font-bold text-center" style={{ width: '5%' }}>BIL</th>
                      <th className="border border-black p-1 bg-gray-100 font-bold text-center" style={{ width: '22%' }}>PERKARA</th>
                      <th className="border border-black p-1 bg-gray-100 font-bold text-center" style={{ width: '73%' }}>MAKLUMAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-black p-1 text-center font-bold">1</td>
                      <td className="border border-black p-1 font-bold">Nama Program</td>
                      <td className="border border-black p-1 text-justify font-semibold">{formData.namaProgram || formData.namaLaporan || '-'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black p-1 text-center font-bold">2</td>
                      <td className="border border-black p-1 font-bold">Tarikh Pelaksanaan</td>
                      <td className="border border-black p-1 text-justify">{formData.tarikhPelaksanaan || '-'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black p-1 text-center font-bold">3</td>
                      <td className="border border-black p-1 font-bold">Sasaran</td>
                      <td className="border border-black p-1 text-justify">{formData.sasaran || '-'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black p-1 text-center font-bold">4</td>
                      <td className="border border-black p-1 font-bold">Anjuran</td>
                      <td className="border border-black p-1 text-justify">{formData.anjuran || '-'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black p-1 text-center font-bold">5</td>
                      <td className="border border-black p-1 font-bold">Objektif</td>
                      <td className="border border-black p-1 whitespace-pre-wrap text-justify">{formData.objektif || '-'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black p-1 text-center font-bold">6</td>
                      <td className="border border-black p-1 font-bold">Kekuatan</td>
                      <td className="border border-black p-1 whitespace-pre-wrap text-justify">{formData.kekuatan || '-'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black p-1 text-center font-bold">7</td>
                      <td className="border border-black p-1 font-bold">Perkara Perlu Penambahbaikan</td>
                      <td className="border border-black p-1 whitespace-pre-wrap text-justify">{formData.perkaraPerluPenambahbaikan || '-'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black p-1 text-center font-bold">8</td>
                      <td className="border border-black p-1 font-bold">Cadangan Penambahbaikan</td>
                      <td className="border border-black p-1 whitespace-pre-wrap text-justify">{formData.cadanganPenambahbaikan || '-'}</td>
                    </tr>
                    {formData.penilaianKeberkesanan && (
                      <tr>
                        <td className="border border-black p-1 text-center font-bold">9</td>
                        <td className="border border-black p-1 font-bold">Penilaian Keberkesanan</td>
                        <td className="border border-black p-1 whitespace-pre-wrap text-justify">{formData.penilaianKeberkesanan}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="border border-black p-1 text-center font-bold">{formData.penilaianKeberkesanan ? '10' : '9'}</td>
                      <td className="border border-black p-1 font-bold">Gambar Pelaksanaan</td>
                      <td className="border border-black p-1">
                        {formData.gambarProgram && formData.gambarProgram.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2 my-1">
                            {formData.gambarProgram.map((url: string, index: number) => (
                              <div key={index} className="flex flex-col">
                                <div className="h-[75px] w-full border border-dashed border-gray-300 flex items-center justify-center bg-gray-50 overflow-hidden">
                                  <img src={url} alt={`Gambar ${index + 1}`} className="max-w-full max-h-full object-contain" />
                                </div>
                                {formData.peneranganGambar && formData.peneranganGambar[index] && (
                                  <p className="text-[9pt] text-center italic mt-0.5">{formData.peneranganGambar[index]}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic text-xs">Tiada gambar dimuat naik.</span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Tandatangan */}
                <div className="flex justify-between mt-4 px-4 text-xs sm:text-sm">
                  <div className="text-left w-2/5">
                    <p className="mb-8">Disediakan oleh:</p>
                    <div className="border-t border-black pt-1">
                      <p className="font-bold uppercase m-0">{formData.disediakanOleh || ' '}</p>
                      <p className="m-0 text-gray-700">{formData.jawatanDisediakanOleh || ' '}</p>
                    </div>
                  </div>
                  <div className="text-left w-2/5">
                    <p className="mb-8">Disahkan oleh:</p>
                    <div className="border-t border-black pt-1">
                      <p className="font-bold uppercase m-0">{formData.disahkanOleh || ' '}</p>
                      <p className="m-0 text-gray-700">{formData.jawatanDisahkanOleh || ' '}</p>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            <div className="p-3 sm:p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
              <span className="text-xs text-gray-500">Pratonton ini menunjukkan format tepat OPR yang akan disimpan atau dicetak.</span>
              <button 
                type="button"
                onClick={() => setShowOprPreview(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Tutup Pratonton
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
