import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

/**
 * P3 — presentational search + filter bar extracted from CRMView. Pure/props-only:
 * CRMView still owns the filter state and passes values + setters down.
 */
interface LeadFiltersBarProps {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  scoreFilter: string;
  setScoreFilter: (v: string) => void;
  assignedFilter: string;
  setAssignedFilter: (v: string) => void;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  tagFilter: string;
  setTagFilter: (v: string) => void;
  allTags: string[];
}

export const LeadFiltersBar: React.FC<LeadFiltersBarProps> = ({
  searchQuery, setSearchQuery, searchInputRef,
  scoreFilter, setScoreFilter,
  assignedFilter, setAssignedFilter,
  sourceFilter, setSourceFilter,
  tagFilter, setTagFilter,
  allTags,
}) => {
  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <div className="relative flex-1">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Kërko sipas emrit, email, telefonit, kompanisë... (shtypni / për fokus)"
          className="pl-9 h-9"
        />
        {searchQuery && (
          <button className="absolute right-3 top-2.5" onClick={() => setSearchQuery('')}>
            <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      <Select value={scoreFilter} onValueChange={setScoreFilter}>
        <SelectTrigger className="w-full sm:w-[145px] h-9">
          <SelectValue placeholder="Pikët" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Të gjitha pikët</SelectItem>
          <SelectItem value="high">I lartë (70+)</SelectItem>
          <SelectItem value="medium">Mesatar (40–69)</SelectItem>
          <SelectItem value="low">I ulët (&lt;40)</SelectItem>
        </SelectContent>
      </Select>
      <Select value={assignedFilter} onValueChange={setAssignedFilter}>
        <SelectTrigger className="w-full sm:w-[140px] h-9">
          <SelectValue placeholder="Asignuara" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Të gjitha</SelectItem>
          <SelectItem value="mine">Të miat</SelectItem>
          <SelectItem value="unassigned">Pa asignuar</SelectItem>
        </SelectContent>
      </Select>
      <Select value={sourceFilter} onValueChange={setSourceFilter}>
        <SelectTrigger className="w-full sm:w-[140px] h-9">
          <SelectValue placeholder="Burimi" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Të gjitha burimet</SelectItem>
          <SelectItem value="Website">Website</SelectItem>
          <SelectItem value="Referral">Referim</SelectItem>
          <SelectItem value="Cold Call">Cold Call</SelectItem>
          <SelectItem value="Social Media">Social Media</SelectItem>
          <SelectItem value="Email">Email</SelectItem>
          <SelectItem value="Event">Event</SelectItem>
          <SelectItem value="Other">Tjetër</SelectItem>
        </SelectContent>
      </Select>
      {allTags.length > 0 && (
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="w-full sm:w-[140px] h-9">
            <SelectValue placeholder="Tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjitha tags</SelectItem>
            {allTags.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
};

export default LeadFiltersBar;
