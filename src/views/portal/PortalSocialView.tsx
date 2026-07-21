import React from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection } from '../../hooks/useFirestore';
import type { SocialSnapshot } from '../../types';
import SocialAnalytics from '../../components/SocialAnalytics';

const PortalSocialView: React.FC = () => {
  const { customerId } = useClientPortal();

  // Clients only ever read their OWN snapshots — scoped by customerId, never by
  // team/business (portal users have no businessId). Tokens live in the separate
  // socialAccounts collection which the portal cannot read.
  const { data: snapshots, loading } = useCollection<SocialSnapshot>('socialSnapshots', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Rrjetet Sociale</h1>
        <p className="text-muted-foreground mt-1">
          Raporti mujor i performancës së Facebook &amp; Instagram, i menaxhuar nga ekipi ynë.
        </p>
      </div>

      <SocialAnalytics
        snapshots={snapshots || []}
        loading={loading || !customerId}
        emptyHint="Raporti i parë do të shfaqet sapo ekipi të lidhë llogaritë tuaja dhe të mbyllet muaji i parë."
      />
    </div>
  );
};

export default PortalSocialView;
