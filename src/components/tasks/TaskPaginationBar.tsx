import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';

// Numbered pagination footer (Prev / "Faqja x / y" / Next). Hidden when single page.
const TaskPaginationBar: React.FC<{
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPage: (p: number) => void;
}> = ({ page, totalPages, totalItems, pageSize, onPage }) => {
  if (totalPages <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalItems);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t bg-background shrink-0">
      <span className="text-xs text-muted-foreground tabular-nums">
        {from}–{to} nga {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Para</span>
        </Button>
        <span className="text-xs text-muted-foreground px-2 tabular-nums whitespace-nowrap">
          Faqja {page + 1} / {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>
          <span className="hidden sm:inline">Pas</span>
          <ChevronRight className="w-4 h-4 sm:ml-1" />
        </Button>
      </div>
    </div>
  );
};

export default TaskPaginationBar;
