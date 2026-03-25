import React, { useState, useEffect, useCallback } from 'react';
import { useGoogleApi, DriveFile } from '../contexts/GoogleApiContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import {
  Search, FolderOpen, File, Image, FileText, Film, Music, Table, Presentation,
  ArrowLeft, ExternalLink, Loader2, Cloud, CloudOff, ChevronRight,
} from 'lucide-react';

const MIME_ICONS: Record<string, React.ElementType> = {
  'application/vnd.google-apps.folder': FolderOpen,
  'application/vnd.google-apps.document': FileText,
  'application/vnd.google-apps.spreadsheet': Table,
  'application/vnd.google-apps.presentation': Presentation,
  'application/pdf': FileText,
  'image/': Image,
  'video/': Film,
  'audio/': Music,
};

function getFileIcon(mimeType: string): React.ElementType {
  if (MIME_ICONS[mimeType]) return MIME_ICONS[mimeType];
  for (const [prefix, icon] of Object.entries(MIME_ICONS)) {
    if (mimeType.startsWith(prefix)) return icon;
  }
  return File;
}

function getMimeColor(mimeType: string): string {
  if (mimeType.includes('folder')) return 'text-amber-500';
  if (mimeType.includes('document') || mimeType.includes('pdf')) return 'text-blue-500';
  if (mimeType.includes('spreadsheet')) return 'text-green-500';
  if (mimeType.includes('presentation')) return 'text-orange-500';
  if (mimeType.startsWith('image/')) return 'text-pink-500';
  if (mimeType.startsWith('video/')) return 'text-purple-500';
  return 'text-gray-500';
}

function formatFileSize(size?: string): string {
  if (!size) return '';
  const bytes = parseInt(size, 10);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface GoogleDrivePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (file: DriveFile) => void;
  multiple?: boolean;
  onSelectMultiple?: (files: DriveFile[]) => void;
}

const GoogleDrivePicker: React.FC<GoogleDrivePickerProps> = ({
  open,
  onOpenChange,
  onSelect,
  multiple = false,
  onSelectMultiple,
}) => {
  const { isConnected, isLoading: apiLoading, connectGoogle, listDriveFiles, searchDriveFiles } = useGoogleApi();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<DriveFile[]>([]);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  const loadFiles = useCallback(async (folderId?: string, query?: string) => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const result = query
        ? await searchDriveFiles(query)
        : await listDriveFiles(undefined, folderId);
      // Sort: folders first, then by modified time
      result.sort((a, b) => {
        const aFolder = a.mimeType === 'application/vnd.google-apps.folder' ? 0 : 1;
        const bFolder = b.mimeType === 'application/vnd.google-apps.folder' ? 0 : 1;
        return aFolder - bFolder;
      });
      setFiles(result);
    } catch (err) {
      console.error('Error loading Drive files:', err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [isConnected, listDriveFiles, searchDriveFiles]);

  // Load files when folder changes or search clears
  useEffect(() => {
    if (open && isConnected) {
      if (searchQuery.trim()) {
        const timer = setTimeout(() => loadFiles(undefined, searchQuery), 400);
        return () => clearTimeout(timer);
      } else {
        loadFiles(currentFolderId);
      }
    }
  }, [open, isConnected, currentFolderId, searchQuery, loadFiles]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setFolderStack([]);
      setSearchQuery('');
      setSelectedFiles([]);
    }
  }, [open]);

  const handleFolderClick = (file: DriveFile) => {
    setSearchQuery('');
    setFolderStack(prev => [...prev, { id: file.id, name: file.name }]);
  };

  const handleBack = () => {
    setFolderStack(prev => prev.slice(0, -1));
  };

  const handleFileClick = (file: DriveFile) => {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      handleFolderClick(file);
      return;
    }
    if (multiple) {
      setSelectedFiles(prev => {
        const exists = prev.find(f => f.id === file.id);
        if (exists) return prev.filter(f => f.id !== file.id);
        return [...prev, file];
      });
    } else {
      onSelect(file);
      onOpenChange(false);
    }
  };

  const handleConfirmMultiple = () => {
    if (onSelectMultiple) {
      onSelectMultiple(selectedFiles);
    } else if (selectedFiles.length > 0) {
      onSelect(selectedFiles[0]);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-500" />
            Google Drive
          </DialogTitle>
        </DialogHeader>

        {!isConnected ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <CloudOff className="w-16 h-16 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-foreground">Lidhu me Google Drive</p>
              <p className="text-sm text-muted-foreground mt-1">
                Jep akses për të parë skedarët e tu në Drive
              </p>
            </div>
            <Button
              onClick={connectGoogle}
              disabled={apiLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {apiLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Cloud className="w-4 h-4 mr-2" />}
              Lidhu me Google
            </Button>
          </div>
        ) : (
          <>
            {/* Search bar */}
            <div className="relative flex-shrink-0">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Kërko skedarë në Drive..."
                className="pl-9 h-9"
              />
            </div>

            {/* Breadcrumb */}
            {!searchQuery.trim() && folderStack.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0 flex-wrap">
                <button onClick={() => setFolderStack([])} className="hover:text-foreground transition-colors">
                  My Drive
                </button>
                {folderStack.map((folder, i) => (
                  <React.Fragment key={folder.id}>
                    <ChevronRight className="w-3 h-3" />
                    <button
                      onClick={() => setFolderStack(prev => prev.slice(0, i + 1))}
                      className={`hover:text-foreground transition-colors ${i === folderStack.length - 1 ? 'text-foreground font-medium' : ''}`}
                    >
                      {folder.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* File list */}
            <ScrollArea className="flex-1 min-h-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : files.length === 0 ? (
                <div className="text-center py-12">
                  <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? 'Asnjë rezultat' : 'Dosja është bosh'}
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {/* Back button */}
                  {folderStack.length > 0 && !searchQuery.trim() && (
                    <button
                      onClick={handleBack}
                      className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-muted transition-colors text-left"
                    >
                      <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Kthehu</span>
                    </button>
                  )}
                  {files.map(file => {
                    const FileIcon = getFileIcon(file.mimeType);
                    const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                    const isSelected = selectedFiles.some(f => f.id === file.id);

                    return (
                      <button
                        key={file.id}
                        onClick={() => handleFileClick(file)}
                        className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-colors text-left group ${
                          isSelected
                            ? 'bg-primary/10 ring-1 ring-primary'
                            : 'hover:bg-muted'
                        }`}
                      >
                        {/* Thumbnail or icon */}
                        {file.thumbnailLink && !isFolder ? (
                          <img
                            src={file.thumbnailLink}
                            alt=""
                            className="w-8 h-8 rounded object-cover flex-shrink-0"
                          />
                        ) : (
                          <FileIcon className={`w-5 h-5 flex-shrink-0 ${getMimeColor(file.mimeType)}`} />
                        )}

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {file.modifiedTime && (
                              <span>{new Date(file.modifiedTime).toLocaleDateString('sq-AL')}</span>
                            )}
                            {file.size && <span>{formatFileSize(file.size)}</span>}
                            {file.shared && <Badge variant="outline" className="text-[9px] px-1 py-0">Shared</Badge>}
                          </div>
                        </div>

                        {!isFolder && file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted-foreground/10 rounded transition-opacity"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                          </a>
                        )}

                        {isFolder && (
                          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Multiple selection footer */}
            {multiple && selectedFiles.length > 0 && (
              <div className="flex items-center justify-between pt-3 border-t flex-shrink-0">
                <span className="text-sm text-muted-foreground">
                  {selectedFiles.length} skedarë të zgjedhur
                </span>
                <Button size="sm" onClick={handleConfirmMultiple}>
                  Konfirmo
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default GoogleDrivePicker;
