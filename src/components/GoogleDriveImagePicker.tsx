import React, { useState, useEffect } from 'react';
import { getGoogleAccessToken } from '../services/driveService';
import toast from 'react-hot-toast';
import { X, FileImage, Loader2, Check } from 'lucide-react';

interface GoogleDriveImagePickerProps {
  onClose: () => void;
  onSelectFiles: (fileUrls: string[]) => void;
  maxFiles: number;
}

export function GoogleDriveImagePicker({ onClose, onSelectFiles, maxFiles }: GoogleDriveImagePickerProps) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const accessToken = getGoogleAccessToken();

  useEffect(() => {
    if (!accessToken) {
      toast.error("Sila log masuk menggunakan Google terlebih dahulu.");
      onClose();
      return;
    }

    const fetchFiles = async () => {
      try {
        const query = encodeURIComponent("mimeType contains 'image/' and trashed = false");
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,thumbnailLink,webContentLink)&pageSize=50&orderBy=modifiedTime desc`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch files');
        }

        const data = await response.json();
        setFiles(data.files || []);
      } catch (error) {
        console.error("Drive API Error:", error);
        toast.error('Gagal memuat turun fail dari Google Drive. Pastikan anda telah memberi kebenaran.');
        onClose();
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, [accessToken, onClose]);

  const handleSelect = (file: any) => {
    const newSelected = new Set(selectedUrls);
    if (newSelected.has(file.id)) {
      newSelected.delete(file.id);
    } else {
      if (newSelected.size >= maxFiles) {
        toast.error(`Anda hanya boleh memilih maksimum ${maxFiles} gambar.`);
        return;
      }
      newSelected.add(file.id);
    }
    setSelectedUrls(newSelected);
  };

  const handleConfirm = async () => {
    if (selectedUrls.size === 0) {
      toast.error('Sila pilih sekurang-kurangnya satu gambar.');
      return;
    }

    const toastId = toast.loading('Memuat turun gambar dari Google Drive...');
    try {
      const processedFiles: string[] = [];
      for (const fileId of Array.from(selectedUrls)) {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to download ${fileId}`);
        }
        
        const blob = await response.blob();
        const reader = new FileReader();
        const base64Url = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        
        processedFiles.push(base64Url);
      }
      
      toast.success('Gambar berjaya dimuat turun.', { id: toastId });
      onSelectFiles(processedFiles);
    } catch (error) {
      console.error(error);
      toast.error('Ralat memuat turun dari Google Drive.', { id: toastId });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileImage className="text-blue-500" size={20} />
            Pilih dari Google Drive
          </h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col min-h-[300px]">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
              <Loader2 className="animate-spin mb-2 text-blue-500" size={24} />
              <p>Memuatkan fail...</p>
            </div>
          ) : files.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
              <FileImage size={48} className="text-gray-300 mb-3" />
              <p>Tiada gambar dijumpai di dalam Google Drive anda.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
              {files.map(file => (
                <div 
                  key={file.id}
                  onClick={() => handleSelect(file)}
                  className={`relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                    selectedUrls.has(file.id) ? 'border-blue-500 shadow-md' : 'border-transparent hover:brightness-95 bg-gray-100'
                  }`}
                >
                  {file.thumbnailLink ? (
                    <img src={file.thumbnailLink} alt={file.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-100">
                      <FileImage className="text-gray-400" size={24} />
                    </div>
                  )}
                  
                  {selectedUrls.has(file.id) && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white border-2 border-white">
                      <Check size={14} strokeWidth={3} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
          <div className="text-sm text-gray-600">
            {selectedUrls.size} / {maxFiles} gambar dipilih
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:bg-gray-200 bg-gray-100 rounded-xl transition-colors font-medium text-sm"
            >
              Batal
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedUrls.size === 0}
              className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors font-medium text-sm"
            >
              Pilih Gambar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
