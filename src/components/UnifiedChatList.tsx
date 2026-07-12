import React, { useMemo, useState } from 'react';
import { Search, X, Sparkles, Users, Plus } from 'lucide-react';

// Unified WhatsApp-style conversation list (chat redesign handoff).
// A single recency-sorted list of clients + staff (DMs) + groups + FivoAI, with a
// single search, filter chips, and a pinned section. The parent (ChatView) builds
// the `conversations` model from its existing data/handlers and passes it in; this
// component owns only the search + filter UI state.

export type ConvType = 'ai' | 'group' | 'client' | 'staff';

export interface UnifiedConv {
  key: string;
  type: ConvType;
  name: string;
  preview: string;
  time: number;        // recency (ms) for sorting
  unread: number;
  online?: boolean;     // staff only
  unassigned?: boolean; // clients with no assigned rep
  pinned?: boolean;
  initials: string;
  statusEmoji?: string; // staff custom status
  isActive: boolean;
  onSelect: () => void;
}

type Filter = 'all' | 'unassigned' | 'clients' | 'groups' | 'staff';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Të gjitha' },
  { key: 'unassigned', label: 'Pa përgjegjës' },
  { key: 'clients', label: 'Klientë' },
  { key: 'groups', label: 'Grupe' },
  { key: 'staff', label: 'Staf' },
];

// Deterministic pastel avatar (sfond/tekst) for client/staff initials.
const PASTELS = [
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  'bg-[#12468C]/10 text-[#12468C] dark:bg-[#12468C]/30 dark:text-[#7AA4DB]',
];
function pastelFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PASTELS[h % PASTELS.length];
}

const TAGS: Record<ConvType, { label: string; cls: string } | null> = {
  ai: { label: 'AI', cls: 'bg-accent-soft text-primary dark:bg-primary/10 dark:text-primary' },
  group: { label: 'Grup', cls: 'bg-accent-soft text-primary dark:bg-primary/10 dark:text-primary' },
  client: { label: 'Klient', cls: 'bg-[#E6F6EF] text-[#1B9E63] dark:bg-emerald-900/30 dark:text-emerald-300' },
  staff: null,
};

const ConversationRow: React.FC<{ c: UnifiedConv }> = ({ c }) => {
  const tag = TAGS[c.type];
  // The open conversation is being read right now — never show its unread badge
  // (mark-as-read clears the underlying count async; this hides it instantly and
  // keeps the WhatsApp/Slack rule that the active chat is never "unread").
  const showUnread = c.unread > 0 && !c.isActive;
  return (
    <button
      onClick={c.onSelect}
      className={`group/row w-full flex items-stretch gap-3 pl-2 pr-2 rounded-[14px] text-left border transition-colors ${
        c.isActive
          ? 'bg-white dark:bg-card border-[#DCE6F5] dark:border-primary/40 shadow-[0_6px_16px_-10px_rgba(12,27,51,0.25)]'
          : 'border-transparent hover:bg-white/60 dark:hover:bg-accent/50'
      }`}
    >
      {/* Avatar */}
      <div className="relative flex items-center flex-shrink-0">
        {c.type === 'ai' ? (
          <div className="h-11 w-11 rounded-full bg-gradient-primary flex items-center justify-center shadow-sm">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
        ) : c.type === 'group' ? (
          <div className="h-11 w-11 rounded-full bg-accent-soft dark:bg-primary/10 flex items-center justify-center">
            <Users className="h-5 w-5 text-primary" />
          </div>
        ) : (
          <div className={`h-11 w-11 rounded-full flex items-center justify-center ${pastelFor(c.key)}`}>
            <span className="text-sm font-bold">{c.initials}</span>
          </div>
        )}
        {c.online && (
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background" />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0 flex items-center gap-2 py-3 border-b border-border/40 group-last/row:border-0 min-h-[64px]">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-foreground">{c.name}</span>
            {tag && (
              <span className={`flex-shrink-0 text-[9.5px] font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded ${tag.cls}`}>{tag.label}</span>
            )}
            {c.statusEmoji && <span className="flex-shrink-0 text-xs opacity-75">{c.statusEmoji}</span>}
          </div>
          {c.unassigned ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-medium text-[#B0863E] dark:text-amber-300/80 truncate">
              <span className="h-1.5 w-1.5 rounded-full bg-[#E0982E] flex-shrink-0" /> Pa përgjegjës
            </p>
          ) : (
            <p className={`mt-0.5 text-[13px] truncate ${showUnread ? 'text-foreground/80 font-medium' : 'text-muted-foreground'}`}>
              {c.preview}
            </p>
          )}
        </div>
        {/* Meta */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {c.time > 0 && (
            <span className={`text-[11.5px] font-medium ${showUnread ? 'font-bold text-primary' : 'text-muted-foreground/60'}`}>
              {formatShort(c.time)}
            </span>
          )}
          {showUnread && (
            <span className="h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold">
              {c.unread > 99 ? '99+' : c.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

function formatShort(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'dje';
  return d.toLocaleDateString('sq-AL', { day: '2-digit', month: '2-digit' });
}

interface Props {
  conversations: UnifiedConv[];
  canCreateGroups?: boolean;
  onCreateGroup?: () => void;
}

const UnifiedChatList: React.FC<Props> = ({ conversations, canCreateGroups, onCreateGroup }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const unassignedCount = useMemo(
    () => conversations.filter(c => c.unassigned).length,
    [conversations]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = conversations;
    if (filter === 'unassigned') list = list.filter(c => c.unassigned);
    else if (filter === 'clients') list = list.filter(c => c.type === 'client');
    else if (filter === 'groups') list = list.filter(c => c.type === 'group');
    else if (filter === 'staff') list = list.filter(c => c.type === 'staff');
    else if (filter === 'all' && !q) {
      // In the main list, hide never-messaged staff (no convo, no unread). They
      // still appear under the "Staf" filter / search so you can start a new DM.
      list = list.filter(c => !(c.type === 'staff' && c.time === 0 && c.unread === 0));
    }
    if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q));
    // Recency sort (pinned handled separately in the 'all' view).
    return [...list].sort((a, b) => b.time - a.time);
  }, [conversations, filter, search]);

  const pinned = filter === 'all' && !search.trim() ? visible.filter(c => c.pinned) : [];
  const rest = filter === 'all' && !search.trim() ? visible.filter(c => !c.pinned) : visible;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#F7F9FC] dark:bg-transparent">
      {/* Single search */}
      <div className="px-3 pt-2 pb-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Kërko bisedë, klient ose person…"
            className="w-full h-10 pl-9 pr-8 text-sm rounded-xl bg-muted/50 border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
          {canCreateGroups && onCreateGroup && (
            <span className="sr-only">krijo grup</span>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 px-4 pt-1 pb-3.5 overflow-x-auto no-scrollbar">
        {FILTERS.map(f => {
          const active = filter === f.key;
          const showCount = f.key === 'unassigned' && unassignedCount > 0;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 py-2 px-[15px] inline-flex items-center gap-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors ${
                active
                  ? 'bg-gradient-secondary text-white border border-transparent shadow-[0_8px_16px_-10px_#12468C]'
                  : 'bg-white dark:bg-card text-[#5B6B85] dark:text-muted-foreground border border-[#E4E9F1] dark:border-border'
              }`}
            >
              {f.key === 'unassigned' && <span className="h-1.5 w-1.5 rounded-full bg-[#E0982E]" />}
              {f.label}
              {showCount && (
                <span className={`text-[11px] font-bold px-[7px] py-px rounded-full ${active ? 'bg-white/25 text-white' : 'bg-[#EEF2F7] dark:bg-muted text-muted-foreground'}`}>
                  {unassignedCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-2 py-1">
        {canCreateGroups && onCreateGroup && (
          <button
            onClick={onCreateGroup}
            className="w-full flex items-center gap-2 px-3 py-2 mb-1 rounded-xl text-[13px] font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Plus className="h-4 w-4" /> Krijo grup të ri
          </button>
        )}

        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground/60">Asnjë bisedë.</p>
        )}

        {pinned.length > 0 && (
          <>
            <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/50">Të fiksuara</p>
            {pinned.map(c => <ConversationRow key={c.key} c={c} />)}
            <p className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/50">Të gjitha bisedat</p>
          </>
        )}
        {rest.map(c => <ConversationRow key={c.key} c={c} />)}
      </div>
    </div>
  );
};

export default UnifiedChatList;
