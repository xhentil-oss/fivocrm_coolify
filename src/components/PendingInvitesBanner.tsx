import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { Mail, ArrowRight } from 'lucide-react';
import { Button } from './ui/button';

const PendingInvitesBanner: React.FC = () => {
  const { user } = useAuth();
  const { data: invites } = useCollection<any>('teamInvites', {
    where: [{ field: 'status', operator: '==', value: 'Pending' }]
  });
  const navigate = useNavigate();

  // Filter invites for the current user's email
  const myInvites = useMemo(() => {
    if (!user?.email || !invites) return [];
    return invites.filter(
      (inv: any) => inv.email?.toLowerCase() === user.email?.toLowerCase()
    );
  }, [user, invites]);

  if (myInvites.length === 0) return null;

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4">
      {myInvites.map((invite: any) => (
        <div key={invite.id} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Mail className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-sm text-foreground truncate">
              Ke një ftesë për tu bashkuar me një ekip
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => navigate(`/join/${invite.token}`)}
          >
            Shiko
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      ))}
    </div>
  );
};

export default PendingInvitesBanner;
