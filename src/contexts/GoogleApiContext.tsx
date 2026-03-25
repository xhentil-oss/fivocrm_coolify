import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from './AuthContext';

// Google API Scopes
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

const CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';

interface GoogleApiContextType {
  isConnected: boolean;
  isLoading: boolean;
  accessToken: string | null;
  connectGoogle: () => Promise<void>;
  disconnectGoogle: () => void;
  // Drive
  listDriveFiles: (query?: string, folderId?: string) => Promise<DriveFile[]>;
  searchDriveFiles: (query: string) => Promise<DriveFile[]>;
  getDriveFile: (fileId: string) => Promise<DriveFile | null>;
  // Calendar
  listCalendarEvents: (timeMin?: string, timeMax?: string) => Promise<CalendarEvent[]>;
  createCalendarEvent: (event: NewCalendarEvent) => Promise<CalendarEvent | null>;
  deleteCalendarEvent: (eventId: string) => Promise<void>;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  owners?: { displayName: string; photoLink?: string }[];
  shared?: boolean;
  parents?: string[];
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; responseStatus?: string; displayName?: string }[];
  htmlLink?: string;
  status?: string;
  colorId?: string;
}

export interface NewCalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  attendees?: { email: string }[];
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
}

const GoogleApiContext = createContext<GoogleApiContextType | null>(null);

// Load the Google Identity Services script
function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById('google-gis-script')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

export function GoogleApiProvider({ children }: { children: React.ReactNode }) {
  useAuth(); // keep auth context active
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const tokenClientRef = useRef<any>(null);
  const resolveRef = useRef<(() => void) | null>(null);
  const rejectRef = useRef<((err: Error) => void) | null>(null);

  // Initialize GIS token client
  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    loadGisScript().then(() => {
      if (cancelled || !(window as any).google?.accounts?.oauth2) return;
      tokenClientRef.current = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response: any) => {
          if (response.error) {
            rejectRef.current?.(new Error(response.error));
            rejectRef.current = null;
            resolveRef.current = null;
            return;
          }
          setAccessToken(response.access_token);
          resolveRef.current?.();
          resolveRef.current = null;
          rejectRef.current = null;
        },
      });
    });
    return () => { cancelled = true; };
  }, []);

  const connectGoogle = useCallback(async () => {
    if (!tokenClientRef.current) {
      throw new Error('Google API nuk është i gatshëm. Sigurohu që VITE_GOOGLE_CLIENT_ID është konfiguruar.');
    }
    setIsLoading(true);
    try {
      await new Promise<void>((resolve, reject) => {
        resolveRef.current = resolve;
        rejectRef.current = reject;
        tokenClientRef.current.requestAccessToken({ prompt: 'consent' });
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnectGoogle = useCallback(() => {
    if (accessToken) {
      (window as any).google?.accounts?.oauth2?.revoke?.(accessToken);
    }
    setAccessToken(null);
  }, [accessToken]);

  // Helper for authenticated API calls
  const apiFetch = useCallback(async (url: string, options?: RequestInit) => {
    if (!accessToken) throw new Error('Nuk jeni i lidhur me Google');
    const resp = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (resp.status === 401) {
      setAccessToken(null);
      throw new Error('Sesioni i Google ka skaduar. Lidhuni përsëri.');
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Google API error: ${resp.status}`);
    }
    return resp.json();
  }, [accessToken]);

  // ── Drive API ──
  const listDriveFiles = useCallback(async (query?: string, folderId?: string) => {
    let q = "trashed=false";
    if (folderId) q += ` and '${folderId}' in parents`;
    if (query) q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,iconLink,thumbnailLink,webViewLink,webContentLink,size,modifiedTime,createdTime,owners,shared,parents)',
      pageSize: '50',
      orderBy: 'modifiedTime desc',
    });
    const data = await apiFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    return (data.files || []) as DriveFile[];
  }, [apiFetch]);

  const searchDriveFiles = useCallback(async (query: string) => {
    const sanitized = query.replace(/'/g, "\\'");
    const q = `trashed=false and (name contains '${sanitized}' or fullText contains '${sanitized}')`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,iconLink,thumbnailLink,webViewLink,webContentLink,size,modifiedTime,createdTime,owners,shared)',
      pageSize: '30',
      orderBy: 'modifiedTime desc',
    });
    const data = await apiFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    return (data.files || []) as DriveFile[];
  }, [apiFetch]);

  const getDriveFile = useCallback(async (fileId: string) => {
    try {
      const data = await apiFetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,iconLink,thumbnailLink,webViewLink,webContentLink,size,modifiedTime,createdTime,owners,shared,parents`
      );
      return data as DriveFile;
    } catch {
      return null;
    }
  }, [apiFetch]);

  // ── Calendar API ──
  const listCalendarEvents = useCallback(async (timeMin?: string, timeMax?: string) => {
    const params = new URLSearchParams({
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    });
    const data = await apiFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
    return (data.items || []) as CalendarEvent[];
  }, [apiFetch]);

  const createCalendarEvent = useCallback(async (event: NewCalendarEvent) => {
    const data = await apiFetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
    return data as CalendarEvent;
  }, [apiFetch]);

  const deleteCalendarEvent = useCallback(async (eventId: string) => {
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }, [accessToken]);

  const value: GoogleApiContextType = {
    isConnected: !!accessToken,
    isLoading,
    accessToken,
    connectGoogle,
    disconnectGoogle,
    listDriveFiles,
    searchDriveFiles,
    getDriveFile,
    listCalendarEvents,
    createCalendarEvent,
    deleteCalendarEvent,
  };

  return (
    <GoogleApiContext.Provider value={value}>
      {children}
    </GoogleApiContext.Provider>
  );
}

export function useGoogleApi() {
  const context = useContext(GoogleApiContext);
  if (!context) {
    throw new Error('useGoogleApi must be used within a GoogleApiProvider');
  }
  return context;
}
