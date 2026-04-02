import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { ScrollArea } from './ui/scroll-area';

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  data: any;
  onSaveNotes?: (notes: string) => void;
  actions?: React.ReactNode;
}

const DetailDrawer: React.FC<DetailDrawerProps> = ({ open, onClose, title, data, onSaveNotes, actions }) => {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Sync notes from data when drawer opens or data changes
  useEffect(() => {
    if (data?.notes) {
      setNotes(data.notes);
    } else {
      setNotes('');
    }
  }, [data?.id, data?.notes]);
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/64 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed top-[72px] right-0 bottom-0 w-full md:w-[480px] bg-card border-l border-border z-50 animate-slide-in-right">
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-h3 text-foreground">{title}</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close drawer"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {actions && (
            <div className="px-6 py-3 border-b border-border">
              {actions}
            </div>
          )}

          <ScrollArea className="flex-1">
            <Tabs defaultValue="overview" className="p-6">
              <TabsList className="w-full bg-muted">
                <TabsTrigger value="overview" className="flex-1 data-[state=active]:bg-background data-[state=active]:text-primary">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="activity" className="flex-1 data-[state=active]:bg-background data-[state=active]:text-primary">
                  Activity
                </TabsTrigger>
                <TabsTrigger value="notes" className="flex-1 data-[state=active]:bg-background data-[state=active]:text-primary">
                  Notes
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6 mt-6">
                <div className="space-y-4">
                  {data && Object.entries(data).map(([key, value]) => {
                    if (key === 'id' || key === 'image') return null;
                    return (
                      <div key={key} className="space-y-1">
                        <p className="text-body-sm text-muted-foreground capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                        <p className="text-body text-foreground">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="activity" className="space-y-4 mt-6">
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-success mt-2" />
                    <div className="flex-1 space-y-1">
                      <p className="text-body text-foreground">Status updated to Active</p>
                      <p className="text-body-sm text-muted-foreground">2 hours ago</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-info mt-2" />
                    <div className="flex-1 space-y-1">
                      <p className="text-body text-foreground">New comment added</p>
                      <p className="text-body-sm text-muted-foreground">5 hours ago</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-warning mt-2" />
                    <div className="flex-1 space-y-1">
                      <p className="text-body text-foreground">Assigned to team member</p>
                      <p className="text-body-sm text-muted-foreground">1 day ago</p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="notes" className="space-y-4 mt-6">
                <textarea
                  placeholder="Shto shënimet tuaja këtu..."
                  rows={8}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-4 py-3 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
                <Button
                  className="w-full bg-primary text-primary-foreground hover:bg-primary-hover"
                  disabled={!onSaveNotes || saving}
                  onClick={async () => {
                    if (!onSaveNotes) return;
                    setSaving(true);
                    try {
                      await onSaveNotes(notes);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? 'Duke ruajtur...' : 'Ruaj Shënimin'}
                </Button>
              </TabsContent>
            </Tabs>
          </ScrollArea>
        </div>
      </div>
    </>
  );
};

export default DetailDrawer;