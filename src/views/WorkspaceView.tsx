import React, { useState, useEffect, useCallback } from 'react';
import { useGoogleApi, DriveFile } from '../contexts/GoogleApiContext';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { CalendarEventsList, CreateEventDialog } from '../components/GoogleCalendar';
import GoogleDrivePicker from '../components/GoogleDrivePicker';
import { useToast } from '../hooks/use-toast';
import {
  FolderOpen, Plus, Cloud, CloudOff, Loader2, ExternalLink, Trash2,
  File, Image, FileText, Film, Table, Presentation, Calendar,
  Grid3X3, List, ChevronRight,
  FolderPlus,
} from 'lucide-react';

// Workspace folder stored in Firestore
interface WorkspaceFolder {
  id: string;
  name: string;
  description?: string;
  color: string;
  driveFileIds: string[]; // IDs of Google Drive files/folders attached
  driveFolderIds: string[]; // IDs of Drive folders to browse into
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

// Cached Drive file metadata stored in Firestore
interface WorkspaceDriveFile {
  id: string;
  folderId: string; // WorkspaceFolder id
  driveFileId: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  size?: string;
  modifiedTime?: string;
  addedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

const FOLDER_COLORS = [
  { value: 'blue', label: 'Blu', class: 'bg-blue-500' },
  { value: 'green', label: 'Jeshile', class: 'bg-green-500' },
  { value: 'purple', label: 'Vjollcë', class: 'bg-purple-500' },
  { value: 'orange', label: 'Portokalli', class: 'bg-orange-500' },
  { value: 'pink', label: 'Rozë', class: 'bg-pink-500' },
  { value: 'cyan', label: 'Cyan', class: 'bg-cyan-500' },
  { value: 'yellow', label: 'E verdhë', class: 'bg-yellow-500' },
  { value: 'red', label: 'E kuqe', class: 'bg-red-500' },
];

const getMimeIcon = (mimeType: string) => {
  if (mimeType?.includes('folder')) return FolderOpen;
  if (mimeType?.includes('document') || mimeType?.includes('pdf')) return FileText;
  if (mimeType?.includes('spreadsheet')) return Table;
  if (mimeType?.includes('presentation')) return Presentation;
  if (mimeType?.startsWith('image/')) return Image;
  if (mimeType?.startsWith('video/')) return Film;
  return File;
};

const getMimeColor = (mimeType: string) => {
  if (mimeType?.includes('folder')) return 'text-amber-500';
  if (mimeType?.includes('document') || mimeType?.includes('pdf')) return 'text-blue-500';
  if (mimeType?.includes('spreadsheet')) return 'text-green-500';
  if (mimeType?.includes('presentation')) return 'text-orange-500';
  if (mimeType?.startsWith('image/')) return 'text-pink-500';
  if (mimeType?.startsWith('video/')) return 'text-purple-500';
  return 'text-gray-500';
};

const WorkspaceView: React.FC = () => {
  const { user } = useAuth();
  const { isConnected, isLoading: apiLoading, connectGoogle, listDriveFiles } = useGoogleApi();
  const { toast } = useToast();

  // Firestore data
  const { data: folders, loading: foldersLoading } = useCollection<WorkspaceFolder>('workspaceFolders', {
    orderBy: { field: 'createdAt', direction: 'asc' },
  });
  const { data: driveFiles, loading: filesLoading } = useCollection<WorkspaceDriveFile>('workspaceDriveFiles');
  const folderMutation = useMutation<WorkspaceFolder>('workspaceFolders');
  const driveFileMutation = useMutation<WorkspaceDriveFile>('workspaceDriveFiles');

  // UI state
  const [activeTab, setActiveTab] = useState<string>('files');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, _setSearchQuery] = useState('');
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [showCalendarCreate, setShowCalendarCreate] = useState(false);

  // Folder form
  const [folderForm, setFolderForm] = useState({ name: '', description: '', color: 'blue' });

  // Live Drive files for browsing linked Drive folders
  const [liveDriveFiles, setLiveDriveFiles] = useState<DriveFile[]>([]);
  const [liveDriveLoading, setLiveDriveLoading] = useState(false);
  const [browsingDriveFolderId, setBrowsingDriveFolderId] = useState<string | null>(null);
  const [driveBreadcrumb, setDriveBreadcrumb] = useState<{ id: string; name: string }[]>([]);

  // Get files for selected workspace folder
  const folderFiles = driveFiles?.filter(f => f.folderId === selectedFolder) || [];

  // Filtered folders
  const filteredFolders = folders?.filter(f =>
    !searchQuery.trim() || f.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Get active folder
  const activeFolder = folders?.find(f => f.id === selectedFolder);

  // Load live Drive folder contents
  const loadDriveFolderContents = useCallback(async (folderId: string) => {
    if (!isConnected) return;
    setLiveDriveLoading(true);
    try {
      const files = await listDriveFiles(undefined, folderId);
      files.sort((a, b) => {
        const aF = a.mimeType === 'application/vnd.google-apps.folder' ? 0 : 1;
        const bF = b.mimeType === 'application/vnd.google-apps.folder' ? 0 : 1;
        return aF - bF;
      });
      setLiveDriveFiles(files);
    } catch (err) {
      console.error('Error loading Drive folder:', err);
      setLiveDriveFiles([]);
    } finally {
      setLiveDriveLoading(false);
    }
  }, [isConnected, listDriveFiles]);

  // When browsing Drive folder changes
  useEffect(() => {
    if (browsingDriveFolderId) {
      loadDriveFolderContents(browsingDriveFolderId);
    }
  }, [browsingDriveFolderId, loadDriveFolderContents]);

  // Create workspace folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderForm.name.trim()) return;
    try {
      await folderMutation.create({
        name: folderForm.name.trim(),
        description: folderForm.description.trim() || undefined,
        color: folderForm.color,
        driveFileIds: [],
        driveFolderIds: [],
      } as any);
      toast({ title: 'Dosja u krijua!' });
      setShowCreateFolder(false);
      setFolderForm({ name: '', description: '', color: 'blue' });
    } catch {
      toast({ title: 'Gabim gjatë krijimit', variant: 'destructive' });
    }
  };

  // Delete workspace folder
  const handleDeleteFolder = async (id: string) => {
    try {
      // Remove all drive files linked to this folder
      const linkedFiles = driveFiles?.filter(f => f.folderId === id) || [];
      for (const file of linkedFiles) {
        await driveFileMutation.remove(file.id);
      }
      await folderMutation.remove(id);
      if (selectedFolder === id) setSelectedFolder(null);
      toast({ title: 'Dosja u fshi' });
    } catch {
      toast({ title: 'Gabim', variant: 'destructive' });
    }
  };

  // Add Drive file to workspace folder
  const handleAddDriveFile = async (file: DriveFile) => {
    if (!selectedFolder) return;
    // Check if already added
    const exists = driveFiles?.find(f => f.folderId === selectedFolder && f.driveFileId === file.id);
    if (exists) {
      toast({ title: 'Ky skedar tashmë ekziston në dosje' });
      return;
    }
    try {
      await driveFileMutation.create({
        folderId: selectedFolder,
        driveFileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink || undefined,
        thumbnailLink: file.thumbnailLink || undefined,
        iconLink: file.iconLink || undefined,
        size: file.size || undefined,
        modifiedTime: file.modifiedTime || undefined,
        addedByUserId: user?.uid || '',
      } as any);

      // If it's a folder, also add to driveFolderIds for live browsing
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        const folder = folders?.find(f => f.id === selectedFolder);
        if (folder && !folder.driveFolderIds?.includes(file.id)) {
          await folderMutation.update(selectedFolder, {
            driveFolderIds: [...(folder.driveFolderIds || []), file.id],
          });
        }
      }

      toast({ title: `"${file.name}" u shtua në dosje` });
    } catch {
      toast({ title: 'Gabim gjatë shtimit', variant: 'destructive' });
    }
  };

  // Remove Drive file from workspace folder
  const handleRemoveDriveFile = async (fileDocId: string, driveFileId: string) => {
    try {
      await driveFileMutation.remove(fileDocId);
      // Remove from driveFolderIds if it was a folder
      if (activeFolder?.driveFolderIds?.includes(driveFileId)) {
        await folderMutation.update(activeFolder.id, {
          driveFolderIds: activeFolder.driveFolderIds.filter(id => id !== driveFileId),
        });
      }
      toast({ title: 'Skedari u hoq' });
    } catch {
      toast({ title: 'Gabim', variant: 'destructive' });
    }
  };

  // Browse into a linked Drive folder
  const handleBrowseDriveFolder = (folderId: string, folderName: string) => {
    setDriveBreadcrumb([{ id: folderId, name: folderName }]);
    setBrowsingDriveFolderId(folderId);
  };

  const handleDriveFolderNavigate = (file: DriveFile) => {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      setDriveBreadcrumb(prev => [...prev, { id: file.id, name: file.name }]);
      setBrowsingDriveFolderId(file.id);
    } else if (file.webViewLink) {
      window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDriveBreadcrumbClick = (index: number) => {
    const newCrumb = driveBreadcrumb.slice(0, index + 1);
    setDriveBreadcrumb(newCrumb);
    setBrowsingDriveFolderId(newCrumb[newCrumb.length - 1].id);
  };

  const closeDriveBrowser = () => {
    setBrowsingDriveFolderId(null);
    setDriveBreadcrumb([]);
    setLiveDriveFiles([]);
  };

  const formatSize = (size?: string) => {
    if (!size) return '';
    const b = parseInt(size, 10);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── RENDER ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Workspace</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Materialet, skedarët & kalendari i ekipit
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
              <Cloud className="w-3 h-3 mr-1" /> Google i lidhur
            </Badge>
          ) : (
            <Button size="sm" onClick={connectGoogle} disabled={apiLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
              {apiLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5 mr-1.5" />}
              Lidhu me Google
            </Button>
          )}
        </div>
      </div>

      {/* Tabs: Files + Calendar */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="files" className="gap-1.5">
            <FolderOpen className="w-4 h-4" />
            Skedarët
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5">
            <Calendar className="w-4 h-4" />
            Kalendari
          </TabsTrigger>
        </TabsList>

        {/* ── FILES TAB ── */}
        <TabsContent value="files" className="mt-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Sidebar: Folders */}
            <div className="w-full lg:w-64 flex-shrink-0 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Dosjet</h3>
                <Button size="sm" variant="ghost" onClick={() => setShowCreateFolder(true)}>
                  <FolderPlus className="w-4 h-4" />
                </Button>
              </div>

              {foldersLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}
                </div>
              ) : filteredFolders.length === 0 ? (
                <div className="text-center py-6">
                  <FolderOpen className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">Krijo dosjen e parë</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowCreateFolder(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Dosje e Re
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredFolders.map(folder => {
                    const colorClass = FOLDER_COLORS.find(c => c.value === folder.color)?.class || 'bg-blue-500';
                    const fileCount = driveFiles?.filter(f => f.folderId === folder.id).length || 0;
                    const isActive = selectedFolder === folder.id;

                    return (
                      <button
                        key={folder.id}
                        onClick={() => { setSelectedFolder(folder.id); closeDriveBrowser(); }}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg transition-colors text-left group ${
                          isActive ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                        }`}
                      >
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colorClass}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{folder.name}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{fileCount}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Main: Folder contents */}
            <div className="flex-1 min-w-0">
              {!selectedFolder ? (
                <Card>
                  <CardContent className="py-16 text-center">
                    <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Zgjidh një dosje ose krijo një të re</p>
                  </CardContent>
                </Card>
              ) : browsingDriveFolderId ? (
                // Live Drive folder browser
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
                      <button onClick={closeDriveBrowser} className="hover:text-foreground font-medium">
                        ← Dosja
                      </button>
                      {driveBreadcrumb.map((crumb, i) => (
                        <React.Fragment key={crumb.id}>
                          <ChevronRight className="w-3 h-3" />
                          <button
                            onClick={() => handleDriveBreadcrumbClick(i)}
                            className={`hover:text-foreground ${i === driveBreadcrumb.length - 1 ? 'text-foreground font-medium' : ''}`}
                          >
                            {crumb.name}
                          </button>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  {liveDriveLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : liveDriveFiles.length === 0 ? (
                    <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Dosja është bosh</CardContent></Card>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {liveDriveFiles.map(file => {
                        const Icon = getMimeIcon(file.mimeType);
                        const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                        return (
                          <button
                            key={file.id}
                            onClick={() => handleDriveFolderNavigate(file)}
                            className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted transition-colors text-left group"
                          >
                            {file.thumbnailLink && !isFolder ? (
                              <img src={file.thumbnailLink} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                            ) : (
                              <Icon className={`w-5 h-5 flex-shrink-0 ${getMimeColor(file.mimeType)}`} />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{file.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {file.modifiedTime && new Date(file.modifiedTime).toLocaleDateString('sq-AL')}
                                {file.size && ` · ${formatSize(file.size)}`}
                              </p>
                            </div>
                            {isFolder && <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                // Workspace folder file list
                <div className="space-y-3">
                  {/* Folder header */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${FOLDER_COLORS.find(c => c.value === activeFolder?.color)?.class || 'bg-blue-500'}`} />
                      <h3 className="font-semibold">{activeFolder?.name}</h3>
                      {activeFolder?.description && (
                        <span className="text-xs text-muted-foreground">— {activeFolder.description}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setViewMode(viewMode === 'grid' ? 'list' : 'grid'); }}>
                        {viewMode === 'grid' ? <List className="w-3.5 h-3.5" /> : <Grid3X3 className="w-3.5 h-3.5" />}
                      </Button>
                      {isConnected && (
                        <Button size="sm" onClick={() => setShowDrivePicker(true)}>
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          Shto nga Drive
                        </Button>
                      )}
                      <Button size="sm" variant="destructive" className="h-8 w-8 p-0" onClick={() => handleDeleteFolder(selectedFolder)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Linked Drive folders (browseable) */}
                  {activeFolder?.driveFolderIds && activeFolder.driveFolderIds.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {folderFiles
                        .filter(f => f.mimeType?.includes('folder'))
                        .map(f => (
                          <Button
                            key={f.id}
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => handleBrowseDriveFolder(f.driveFileId, f.name)}
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                            {f.name}
                            <ChevronRight className="w-3 h-3 text-muted-foreground" />
                          </Button>
                        ))}
                    </div>
                  )}

                  {/* File list */}
                  {filesLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : folderFiles.filter(f => !f.mimeType?.includes('folder')).length === 0 && !activeFolder?.driveFolderIds?.length ? (
                    <Card>
                      <CardContent className="py-12 text-center">
                        {isConnected ? (
                          <>
                            <Cloud className="w-10 h-10 text-blue-400 mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground mb-3">Shto skedarë nga Google Drive</p>
                            <Button size="sm" onClick={() => setShowDrivePicker(true)}>
                              <Plus className="w-3.5 h-3.5 mr-1" /> Shto Skedarë
                            </Button>
                          </>
                        ) : (
                          <>
                            <CloudOff className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground mb-3">Lidhu me Google për të shtuar skedarë</p>
                            <Button size="sm" onClick={connectGoogle} disabled={apiLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
                              <Cloud className="w-3.5 h-3.5 mr-1.5" /> Lidhu me Google
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  ) : (
                    viewMode === 'grid' ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {folderFiles.filter(f => !f.mimeType?.includes('folder')).map(file => {
                          const Icon = getMimeIcon(file.mimeType);
                          return (
                            <Card key={file.id} className="group hover:shadow-md transition-all">
                              <CardContent className="p-3 space-y-2">
                                <div className="flex items-start justify-between">
                                  {file.thumbnailLink ? (
                                    <img src={file.thumbnailLink} alt="" className="w-10 h-10 rounded object-cover" />
                                  ) : (
                                    <Icon className={`w-8 h-8 ${getMimeColor(file.mimeType)}`} />
                                  )}
                                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {file.webViewLink && (
                                      <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-muted rounded">
                                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                                      </a>
                                    )}
                                    <button onClick={() => handleRemoveDriveFile(file.id, file.driveFileId)} className="p-1 hover:bg-destructive/10 rounded">
                                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                    </button>
                                  </div>
                                </div>
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                  {file.modifiedTime && <span>{new Date(file.modifiedTime).toLocaleDateString('sq-AL')}</span>}
                                  {file.size && <span>{formatSize(file.size)}</span>}
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {folderFiles.filter(f => !f.mimeType?.includes('folder')).map(file => {
                          const Icon = getMimeIcon(file.mimeType);
                          return (
                            <div key={file.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors group">
                              <Icon className={`w-4 h-4 flex-shrink-0 ${getMimeColor(file.mimeType)}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm truncate">{file.name}</p>
                              </div>
                              <span className="text-[10px] text-muted-foreground">
                                {file.modifiedTime && new Date(file.modifiedTime).toLocaleDateString('sq-AL')}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {file.size && formatSize(file.size)}
                              </span>
                              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {file.webViewLink && (
                                  <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-muted rounded">
                                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                                  </a>
                                )}
                                <button onClick={() => handleRemoveDriveFile(file.id, file.driveFileId)} className="p-1 hover:bg-destructive/10 rounded">
                                  <Trash2 className="w-3 h-3 text-destructive" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── CALENDAR TAB ── */}
        <TabsContent value="calendar" className="mt-4">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <CalendarEventsList />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Folder Dialog */}
      <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="w-5 h-5" />
              Dosje e Re
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateFolder} className="space-y-4">
            <div className="space-y-2">
              <Label>Emri *</Label>
              <Input
                value={folderForm.name}
                onChange={e => setFolderForm(p => ({ ...p, name: e.target.value }))}
                placeholder="psh. Materialet e Brandingut"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Përshkrimi</Label>
              <Input
                value={folderForm.description}
                onChange={e => setFolderForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Përshkrim i shkurtër"
              />
            </div>
            <div className="space-y-2">
              <Label>Ngjyra</Label>
              <div className="flex gap-2 flex-wrap">
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setFolderForm(p => ({ ...p, color: c.value }))}
                    className={`w-7 h-7 rounded-full ${c.class} transition-all ${
                      folderForm.color === c.value ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'opacity-60 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowCreateFolder(false)}>Anulo</Button>
              <Button type="submit" disabled={!folderForm.name.trim()}>Krijo Dosjen</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Drive Picker */}
      <GoogleDrivePicker
        open={showDrivePicker}
        onOpenChange={setShowDrivePicker}
        onSelect={handleAddDriveFile}
        multiple
        onSelectMultiple={files => files.forEach(handleAddDriveFile)}
      />

      {/* Calendar Create Event */}
      <CreateEventDialog
        open={showCalendarCreate}
        onOpenChange={setShowCalendarCreate}
        onCreated={() => {}}
      />
    </div>
  );
};

export default WorkspaceView;
