export const getGoogleAccessToken = (): string | null => {
  const token = localStorage.getItem('googleAccessToken');
  const time = localStorage.getItem('googleTokenTime');
  
  if (!token || !time) return null;
  
  // Token expires in 1 hour (3600 seconds), let's use 50 minutes to be safe
  const isExpired = Date.now() - parseInt(time) > 50 * 60 * 1000;
  if (isExpired) {
    localStorage.removeItem('googleAccessToken');
    localStorage.removeItem('googleTokenTime');
    return null;
  }
  
  return token;
};

export const createDriveFolder = async (accessToken: string, folderName: string): Promise<string> => {
  // Check if folder already exists
  const safeFolderName = folderName.replace(/'/g, "\\'");
  const query = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${safeFolderName}' and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id; // Return existing folder ID
    }
  }

  // Create new folder
  const metadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };

  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const errorData = await res.text();
    console.error('Drive API Error:', errorData);
    if (res.status === 403 && errorData.includes('Drive API has not been used')) {
      throw new Error('Google Drive API belum diaktifkan di Google Cloud Console anda. Sila aktifkan API tersebut.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Akses ditolak. Sila log keluar dan log masuk semula untuk memberikan kebenaran Google Drive.');
    }
    throw new Error(`Failed to create folder in Google Drive: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.id;
};

export const uploadTextToDrive = async (accessToken: string, textContent: string, filename: string, folderId: string) => {
  try {
    const metadata = {
      name: filename,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document', // Create as Google Doc
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([textContent], { type: 'text/html' })); // Use HTML for basic formatting

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    });

    if (!res.ok) {
      const errorData = await res.text();
      console.error('Drive API Error (uploadText):', errorData);
      throw new Error(`Failed to upload document ${filename}: ${res.status} ${res.statusText}`);
    }

    return await res.json();
  } catch (error) {
    console.error('Drive upload error:', error);
    throw error;
  }
};

export const uploadImageToDrive = async (accessToken: string, imageUrl: string, filename: string, folderId: string) => {
  try {
    // Fetch the image as a blob
    const imageRes = await fetch(imageUrl);
    const blob = await imageRes.blob();

    // Step 1: Create file metadata
    const metadata = {
      name: filename,
      parents: [folderId],
    };

    const metaRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    if (!metaRes.ok) {
      const errorData = await metaRes.text();
      console.error('Drive API Error (uploadImage metadata):', errorData);
      throw new Error(`Failed to create metadata for ${filename}: ${metaRes.status} ${metaRes.statusText}`);
    }

    const fileData = await metaRes.json();
    const fileId = fileData.id;

    // Step 2: Upload media content
    const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': blob.type || 'image/jpeg',
      },
      body: blob,
    });

    if (!uploadRes.ok) {
      const errorData = await uploadRes.text();
      console.error('Drive API Error (uploadImage content):', errorData);
      throw new Error(`Failed to upload content for ${filename}: ${uploadRes.status} ${uploadRes.statusText}`);
    }

    return await uploadRes.json();
  } catch (error) {
    console.error('Drive upload error:', error);
    throw error;
  }
};
