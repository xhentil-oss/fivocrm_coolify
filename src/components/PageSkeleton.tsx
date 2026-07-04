import React from 'react';
import { Skeleton } from './ui/skeleton';
import { Card } from './ui/card';

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-16" />
          </Card>
        ))}
      </div>

      {/* Table skeleton */}
      <Card className="p-4 space-y-3">
        <Skeleton className="h-10 w-full" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </Card>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <Card className="p-4 space-y-3">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-full" />
    </Card>
  );
}

export function KanbanSkeleton() {
  return (
    <div className="flex gap-4 p-4 overflow-x-auto">
      {[1, 2, 3, 4].map((col) => (
        <div key={col} className="min-w-[280px] space-y-3">
          <Skeleton className="h-6 w-24" />
          {[1, 2, 3].map((card) => (
            <Card key={card} className="p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex justify-between pt-2">
                <Skeleton className="h-5 w-5 rounded-full" />
                <Skeleton className="h-3 w-16" />
              </div>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A simple list of stacked rows (e.g. table/list views). */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="p-4 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </Card>
  );
}

export type SkeletonVariant = 'page' | 'kanban' | 'card' | 'list';

/**
 * Single reusable loading placeholder. Prefer this over ad-hoc
 * "Duke ngarkuar..." text so every module shows a consistent skeleton.
 */
export function SkeletonLoader({ variant = 'page', rows }: { variant?: SkeletonVariant; rows?: number }) {
  switch (variant) {
    case 'kanban': return <KanbanSkeleton />;
    case 'card': return <CardSkeleton />;
    case 'list': return <ListSkeleton rows={rows} />;
    case 'page':
    default: return <PageSkeleton />;
  }
}
