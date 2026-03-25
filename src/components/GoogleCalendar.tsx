import React, { useState, useEffect } from 'react';
import { useGoogleApi, CalendarEvent, NewCalendarEvent } from '../contexts/GoogleApiContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import {
  Calendar, Clock, MapPin, Users, Plus, Trash2, Loader2, ExternalLink,
  Cloud, CloudOff,
} from 'lucide-react';
import { useToast } from '../hooks/use-toast';

// ── Calendar Events List ──
interface CalendarEventsProps {
  compact?: boolean;
}

export const CalendarEventsList: React.FC<CalendarEventsProps> = ({ compact = false }) => {
  const { isConnected, isLoading: apiLoading, connectGoogle, listCalendarEvents, deleteCalendarEvent } = useGoogleApi();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const { toast } = useToast();

  const loadEvents = async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const result = await listCalendarEvents();
      setEvents(result);
    } catch (err) {
      console.error('Error loading calendar events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected) loadEvents();
  }, [isConnected]);

  const handleDelete = async (eventId: string) => {
    try {
      await deleteCalendarEvent(eventId);
      setEvents(prev => prev.filter(e => e.id !== eventId));
      toast({ title: 'Ngjarja u fshi' });
    } catch {
      toast({ title: 'Gabim gjatë fshirjes', variant: 'destructive' });
    }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <CloudOff className="w-10 h-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Lidhu me Google Calendar</p>
        <Button size="sm" onClick={connectGoogle} disabled={apiLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
          {apiLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5 mr-1.5" />}
          Lidhu
        </Button>
      </div>
    );
  }

  const formatEventTime = (event: CalendarEvent) => {
    const start = event.start.dateTime || event.start.date;
    const end = event.end.dateTime || event.end.date;
    if (!start) return '';
    const d = new Date(start);
    const dateStr = d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' });
    if (!event.start.dateTime) return dateStr; // All-day event
    const timeStr = d.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' });
    if (end) {
      const endTime = new Date(end).toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' });
      return `${dateStr} · ${timeStr} – ${endTime}`;
    }
    return `${dateStr} · ${timeStr}`;
  };

  const isToday = (event: CalendarEvent) => {
    const start = event.start.dateTime || event.start.date;
    if (!start) return false;
    const d = new Date(start);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {!compact && <h3 className="text-sm font-semibold">Ngjarjet e ardhshme</h3>}
        <Button size="sm" variant="outline" onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Shto Takim
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-6">
          <Calendar className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Asnjë ngjarje e ardhshme</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.slice(0, compact ? 5 : 20).map(event => (
            <div
              key={event.id}
              className={`flex items-start gap-3 p-2.5 rounded-lg border transition-colors group ${
                isToday(event) ? 'bg-primary/5 border-primary/20' : 'hover:bg-muted'
              }`}
            >
              <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                isToday(event) ? 'bg-primary' : 'bg-muted-foreground/30'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{event.summary || '(Pa titull)'}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  <span>{formatEventTime(event)}</span>
                </div>
                {event.location && (
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{event.location}</span>
                  </div>
                )}
                {event.attendees && event.attendees.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <Users className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">
                      {event.attendees.length} pjesëmarrës
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {event.htmlLink && (
                  <a
                    href={event.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 hover:bg-muted rounded"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                  </a>
                )}
                <button onClick={() => handleDelete(event.id)} className="p-1 hover:bg-destructive/10 rounded">
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateEventDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={() => loadEvents()}
      />
    </div>
  );
};

// ── Create Calendar Event Dialog ──
interface CreateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  prefillTitle?: string;
  prefillAttendees?: string[];
  prefillDate?: string;
}

export const CreateEventDialog: React.FC<CreateEventDialogProps> = ({
  open,
  onOpenChange,
  onCreated,
  prefillTitle = '',
  prefillAttendees = [],
  prefillDate,
}) => {
  const { createCalendarEvent } = useGoogleApi();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    summary: prefillTitle,
    description: '',
    location: '',
    date: prefillDate || new Date().toISOString().split('T')[0],
    startTime: '10:00',
    endTime: '11:00',
    attendeeEmail: '',
    attendees: prefillAttendees,
  });

  useEffect(() => {
    if (open) {
      setForm(prev => ({
        ...prev,
        summary: prefillTitle,
        attendees: prefillAttendees,
        date: prefillDate || new Date().toISOString().split('T')[0],
      }));
    }
  }, [open, prefillTitle, prefillAttendees, prefillDate]);

  const addAttendee = () => {
    const email = form.attendeeEmail.trim();
    if (email && !form.attendees.includes(email)) {
      setForm(prev => ({ ...prev, attendees: [...prev.attendees, email], attendeeEmail: '' }));
    }
  };

  const removeAttendee = (email: string) => {
    setForm(prev => ({ ...prev, attendees: prev.attendees.filter(e => e !== email) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.summary.trim()) return;

    setSaving(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const event: NewCalendarEvent = {
        summary: form.summary,
        description: form.description || undefined,
        location: form.location || undefined,
        start: { dateTime: `${form.date}T${form.startTime}:00`, timeZone: tz },
        end: { dateTime: `${form.date}T${form.endTime}:00`, timeZone: tz },
        attendees: form.attendees.length > 0 ? form.attendees.map(e => ({ email: e })) : undefined,
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
      };
      await createCalendarEvent(event);
      toast({ title: 'Takimi u shtua në Google Calendar!' });
      onCreated();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Gabim', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            Shto Takim
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Titulli *</Label>
            <Input
              value={form.summary}
              onChange={e => setForm(prev => ({ ...prev, summary: e.target.value }))}
              placeholder="psh. Takim me klientin"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                type="date"
                value={form.date}
                onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Fillimi</Label>
              <Input
                type="time"
                value={form.startTime}
                onChange={e => setForm(prev => ({ ...prev, startTime: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Mbarimi</Label>
              <Input
                type="time"
                value={form.endTime}
                onChange={e => setForm(prev => ({ ...prev, endTime: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Vendndodhja</Label>
            <Input
              value={form.location}
              onChange={e => setForm(prev => ({ ...prev, location: e.target.value }))}
              placeholder="Google Meet, Zyrë, etj."
            />
          </div>

          <div className="space-y-2">
            <Label>Përshkrimi</Label>
            <Textarea
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Shënime shtesë..."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Pjesëmarrësit</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                value={form.attendeeEmail}
                onChange={e => setForm(prev => ({ ...prev, attendeeEmail: e.target.value }))}
                placeholder="email@shembull.com"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAttendee(); } }}
              />
              <Button type="button" variant="outline" size="sm" onClick={addAttendee}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {form.attendees.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {form.attendees.map(email => (
                  <Badge
                    key={email}
                    variant="secondary"
                    className="text-xs cursor-pointer hover:bg-destructive/10"
                    onClick={() => removeAttendee(email)}
                  >
                    {email} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Anulo
            </Button>
            <Button type="submit" disabled={saving || !form.summary.trim()} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Calendar className="w-4 h-4 mr-1.5" />}
              Ruaj Takimin
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CalendarEventsList;
