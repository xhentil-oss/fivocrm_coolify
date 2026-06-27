import React, { useMemo, useState } from 'react';
import { Search, X, Sparkles, Users, AlertTriangle, Plus } from 'lucide-react';

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
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
];
function pastelFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PASTELS[h % PASTELS.length];
}

const TAGS: Record<ConvType, { label: string; cls: string } | null> = {
  ai: { label: 'AI', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  group: { label: 'Grup', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  client: { label: 'Klient', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  staff: null,
};

const ConversationRow: React.FC<{ c: UnifiedConv }> = ({ c }) => {
  const tag = TAGS[c.type];
  return (
    <button
      onClick={c.onSelect}
      className={`group/row w-full flex items-stretch gap-3 pl-2 pr-2 rounded-xl text-left transition-colors ${
        c.isActive ? 'bg-violet-500/10 border border-violet-300/30 dark:border-violet-700/30' : 'hover:bg-accent/50'
      }`}
    >
      {/* Avatar */}
      <div className="relative flex items-center flex-shrink-0">
        {c.type === 'ai' ? (
          <div className="h-11 w-11 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
        ) : c.type === 'group' ? (
          <div className="h-11 w-11 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Users className="h-5 w-5 text-violet-600 dark:text-violet-300" />
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
              <span className={`flex-shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${tag.cls}`}>{tag.label}</span>
            )}
            {c.statusEmoji && <span className="flex-shrink-0 text-xs opacity-75">{c.statusEmoji}</span>}
          </div>
          {c.unassigned ? (
            <p className="mt-0.5 flex items-center gap-1 text-[13px] font-bold text-amber-600 dark:text-amber-400 truncate">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" /> Pa përgjegjës
            </p>
          ) : (
            <p className={`mt-0.5 text-[13px] truncate ${c.unread > 0 ? 'text-foreground/80 font-medium' : 'text-muted-foreground'}`}>
              {c.preview}
            </p>
          )}
        </div>
        {/* Meta */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {c.time > 0 && (
            <span className={`text-[11px] ${c.unread > 0 ? 'font-bold text-violet-600 dark:text-violet-400' : 'text-muted-foreground/60'}`}>
              {formatShort(c.time)}
            </span>
          )}
          {c.unread > 0 && (
            <span className="h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full bg-violet-600 text-white text-[11px] font-bold">
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
    <div className="flex flex-col flex-1 min-h-0">
      {/* Single search */}
      <div className="px-3 pt-2 pb-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Kërko bisedë, klient ose person…"
            className="w-full h-10 pl-9 pr-8 text-sm rounded-xl bg-muted/50 border border-border/50 focus:outline-none focus:ring-1 focus:ring-violet-400"
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
      <div className="flex gap-2 px-3 py-2 overflow-x-auto no-scrollbar border-b border-border/50">
        {FILTERS.map(f => {
          const active = filter === f.key;
          const showCount = f.key === 'unassigned' && unassignedCount > 0;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-[13px] font-bold whitespace-nowrap transition-colors ${
                active ? 'bg-violet-600 text-white' : 'bg-background text-muted-foreground border border-border'
              }`}
            >
              {f.key === 'unassigned' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
              {f.label}
              {showCount && (
                <span className={`text-[11px] px-1.5 rounded-full ${active ? 'bg-white/25 text-white' : 'bg-muted text-muted-foreground'}`}>
                  {unassignedCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {canCreateGroups && onCreateGroup && (
          <button
            onClick={onCreateGroup}
            className="w-full flex items-center gap-2 px-3 py-2 mb-1 rounded-xl text-[13px] font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors"
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
