import React from 'react';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';

/** Row of stat cards (dashboard). */
export const StatCardsSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <Card key={i}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-12" />
            </div>
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
);

/** A card whose body is a few list rows. */
export const ListCardSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <Card>
    <CardHeader className="pb-3">
      <Skeleton className="h-5 w-40" />
    </CardHeader>
    <CardContent>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);

/** Grid of card-shaped items (services catalog, quotes, contracts). */
export const CardGridSkeleton: React.FC<{ count?: number; cols?: string }> = ({
  count = 6,
  cols = 'sm:grid-cols-2 lg:grid-cols-3',
}) => (
  <div className={`grid grid-cols-1 gap-4 ${cols}`}>
    {Array.from({ length: count }).map((_, i) => (
      <Card key={i}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-1/2 mt-2" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-8 w-full rounded-lg mt-2" />
        </CardContent>
      </Card>
    ))}
  </div>
);

/** Full dashboard skeleton (stats + one list card). */
export const DashboardSkeleton: React.FC = () => (
  <div className="space-y-6">
    <div className="space-y-2">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-48" />
    </div>
    <StatCardsSkeleton count={4} />
    <ListCardSkeleton rows={4} />
    <ListCardSkeleton rows={3} />
  </div>
);
