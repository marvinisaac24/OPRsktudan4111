import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { getGoogleAccessToken } from './driveService';

export const requestDriveAccess = async (): Promise<string | null> => {
  let token = getGoogleAccessToken();
  if (token) return token;

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      localStorage.setItem('googleAccessToken', credential.accessToken);
      localStorage.setItem('googleTokenTime', Date.now().toString());
      // Fire an event to let the rest of the app know
      window.dispatchEvent(new Event('driveAccessChanged'));
      return credential.accessToken;
    }
  } catch (error) {
    console.error("Failed to authenticate with Google Drive", error);
    throw error;
  }
  return null;
}
