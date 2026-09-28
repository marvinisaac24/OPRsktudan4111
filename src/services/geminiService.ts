// Gemini service client interacting with backend API routes (/api/gemini/*)
// to keep GEMINI_API_KEY secure on the server side.

// Ensure TypeScript knows about window.aistudio
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export const handleGenAIError = (error: any) => {
  console.error("Gemini API Error:", error);
  const errMsg = typeof error === 'string' ? error : (error?.message || '');

  if (errMsg.includes('429') || errMsg.includes('quota') || error?.status === 'RESOURCE_EXHAUSTED' || errMsg.includes('RESOURCE_EXHAUSTED')) {
    throw new Error("Had kuota AI Gemini anda telah tamat. Sila periksa pelan dan billing anda.");
  }
  
  if (error?.status === 'UNAVAILABLE' || errMsg.includes('503') || errMsg.includes('Unable to process input image')) {
    throw new Error("Perkhidmatan AI Gemini tidak tersedia buat sementara waktu atau gagal memproses gambar ini. Sila cuba sebentar lagi atau gunakan gambar yang lain.");
  }

  // Avoid double prefixing if it's already our custom error message
  if (errMsg.includes('Gagal memproses') || errMsg.includes('Had kuota')) {
    throw error;
  }

  if (errMsg) {
    throw new Error(`Ralat AI: ${errMsg}`);
  }
  
  throw new Error("Gagal menyambung ke perkhidmatan AI. Sila cuba lagi.");
};

export const ensurePaidApiKey = async () => {
  if (window.aistudio && window.aistudio.hasSelectedApiKey) {
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      await window.aistudio.openSelectKey();
    }
  }
};

export const analyzeImageForReport = async (base64Image: string, mimeType: string) => {
  try {
    const res = await fetch("/api/gemini/analyze-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Image, mimeType }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Gagal menganalisis gambar.");
    }
    return data;
  } catch (error: any) {
    handleGenAIError(error);
  }
  throw new Error("No response from Gemini");
};

export const generateImageDescription = async (base64Image: string, mimeType: string) => {
  try {
    const res = await fetch("/api/gemini/image-description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Image, mimeType }),
    });

    const data = await res.json();
    if (data?.description) {
      return data.description;
    }
    return "Aktiviti murid dan warga sekolah semasa program dijalankan.";
  } catch (error: any) {
    console.warn("generateImageDescription error caught gracefully:", error);
    return "Aktiviti murid dan warga sekolah semasa program dijalankan.";
  }
};

export const generateTextSuggestion = async (reportData: any, field: string) => {
  try {
    const res = await fetch("/api/gemini/suggest-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportData, field }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Gagal menjana cadangan teks.");
    }
    return data.suggestion;
  } catch (error: any) {
    handleGenAIError(error);
  }
  throw new Error("No response from Gemini");
};

export const generateImage = async (
  prompt: string,
  aspectRatio: string,
  imageSize: string = "1K",
  isStudioQuality: boolean = false
) => {
  await ensurePaidApiKey();
  try {
    const res = await fetch("/api/gemini/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, aspectRatio, imageSize, isStudioQuality }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Gagal menjana gambar.");
    }
    return data.imageBase64;
  } catch (error: any) {
    handleGenAIError(error);
  }
  throw new Error("No image generated");
};

export const editImage = async (
  base64Image: string,
  mimeType: string,
  prompt: string,
  isStudioQuality: boolean = false
) => {
  await ensurePaidApiKey();
  try {
    const res = await fetch("/api/gemini/edit-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Image, mimeType, prompt, isStudioQuality }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Gagal menyunting gambar.");
    }
    return data.imageBase64;
  } catch (error: any) {
    handleGenAIError(error);
  }
  throw new Error("No image generated");
};

export interface ExtractedKertasKerjaResult {
  namaProgram?: string;
  singkatanProgram?: string;
  tarikhPelaksanaan?: string;
  tempat?: string;
  sasaran?: string;
  anjuran?: string;
  objektif?: string;
  kekuatan?: string;
  cadanganPenambahbaikan?: string;
}

export const extractInfoFromKertasKerja = async (params: {
  fileData?: string;
  fileName?: string;
  mimeType?: string;
  textContent?: string;
}): Promise<ExtractedKertasKerjaResult> => {
  try {
    const res = await fetch("/api/gemini/extract-kertas-kerja", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Gagal mengekstrak maklumat kertas kerja.");
    }
    return data;
  } catch (error: any) {
    handleGenAIError(error);
  }
  throw new Error("Gagal mengekstrak kertas kerja.");
};

export interface AnalyzedFeedbackResult {
  penilaianKeberkesanan?: string;
  cadanganPenambahbaikan?: string;
  kekuatan?: string;
  perkaraPerluPenambahbaikan?: string;
}

export const analyzeFeedbackForm = async (params: {
  fileData?: string;
  fileName?: string;
  mimeType?: string;
  textContent?: string;
  programContext?: string;
}): Promise<AnalyzedFeedbackResult> => {
  try {
    const res = await fetch("/api/gemini/analyze-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Gagal menganalisis borang maklum balas.");
    }
    return data;
  } catch (error: any) {
    handleGenAIError(error);
  }
  throw new Error("Gagal menganalisis maklum balas.");
};

