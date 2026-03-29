import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, updateDoc, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Loader2, CheckCircle, XCircle, Users, Shield } from 'lucide-react';

interface InviteData {
  id: string;
  teamId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: any;
  invitedByUserId: string;
  canAccessProjects?: boolean;
  canAccessTasks?: boolean;
  canAccessCRM?: boolean;
  canAccessInvoices?: boolean;
  canAccessReports?: boolean;
  canAccessSettings?: boolean;
  status: string;
}

const JoinInviteView: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [invite, setInvite] = useState<InviteData | null>(null);
  const [teamName, setTeamName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Look up the invite by token
  useEffect(() => {
    if (!token) {
      setError('Link i pavlefshëm - mungon tokeni.');
      setLoading(false);
      return;
    }

    const lookupInvite = async () => {
      try {
        const q = query(
          collection(db, 'teamInvites'),
          where('token', '==', token)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          setError('Ftesa nuk u gjet. Mund të jetë fshirë ose linku është i gabuar.');
          setLoading(false);
          return;
        }

        const inviteDoc = snapshot.docs[0];
        const data = inviteDoc.data() as Omit<InviteData, 'id'>;
        const inviteData: InviteData = { id: inviteDoc.id, ...data };

        // Check if already accepted/cancelled
        if (data.status === 'Accepted') {
          setError('Kjo ftesë është pranuar tashmë.');
          setLoading(false);
          return;
        }
        if (data.status === 'Cancelled') {
          setError('Kjo ftesë është anuluar nga administratori.');
          setLoading(false);
          return;
        }

        // Check expiration
        const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
        if (expiresAt < new Date()) {
          setError('Kjo ftesë ka skaduar. Kërko një ftesë të re nga administratori.');
          setLoading(false);
          return;
        }

        setInvite(inviteData);

        // Get team name
        const teamQuery = query(collection(db, 'teams'));
        const teamSnapshot = await getDocs(teamQuery);
        const team = teamSnapshot.docs.find(d => d.id === data.teamId);
        if (team) {
          setTeamName(team.data().name || 'Ekip');
        }

        setLoading(false);
      } catch (err) {
        console.error('Error looking up invite:', err);
        setError('Gabim gjatë kërkimit të ftesës.');
        setLoading(false);
      }
    };

    lookupInvite();
  }, [token]);

  const handleAccept = async () => {
    if (!invite || !user) return;

    setAccepting(true);
    try {
      // Create team member
      await addDoc(collection(db, 'teamMembers'), {
        userId: user.uid,
        email: user.email || invite.email || '',
        displayName: user.displayName || user.email?.split('@')[0] || '',
        teamId: invite.teamId,
        role: invite.role,
        canAccessProjects: invite.canAccessProjects ?? false,
        canAccessTasks: invite.canAccessTasks ?? false,
        canAccessCRM: invite.canAccessCRM ?? false,
        canAccessInvoices: invite.canAccessInvoices ?? false,
        canAccessReports: invite.canAccessReports ?? false,
        canAccessSettings: invite.canAccessSettings ?? false,
        invitedByUserId: invite.invitedByUserId,
        invitedAt: Timestamp.now(),
        status: 'Active',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user.uid,
      });

      // Update invite status to Accepted
      const inviteRef = doc(db, 'teamInvites', invite.id);
      await updateDoc(inviteRef, {
        status: 'Accepted',
        acceptedByUserId: user.uid,
        acceptedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      // Create userProfile with displayName so the user appears in mentions
      try {
        const existingProfiles = await getDocs(query(collection(db, 'userProfiles'), where('userId', '==', user.uid)));
        if (existingProfiles.empty) {
          await addDoc(collection(db, 'userProfiles'), {
            userId: user.uid,
            displayName: user.displayName || user.email?.split('@')[0] || '',
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            createdByUserId: user.uid,
          });
        }
      } catch {
        // Non-critical
      }

      setSuccess(true);
    } catch (err) {
      console.error('Error accepting invite:', err);
      setError('Gabim gjatë pranimit të ftesës. Provo përsëri.');
    } finally {
      setAccepting(false);
    }
  };

  // Loading states
  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Duke kontrolluar ftesën...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Ftesa nuk mund të hapet</h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Link to="/login">
            <Button variant="outline">Kthehu në hyrje</Button>
          </Link>
        </Card>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">U bashkove me sukses!</h2>
          <p className="text-muted-foreground mb-2">
            Tani je anëtar i ekipit <strong>{teamName}</strong>
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Roli yt: <Badge variant="secondary">{invite?.role}</Badge>
          </p>
          <Button onClick={() => navigate('/app/profile')} className="w-full">
            Hyr në platformë
          </Button>
        </Card>
      </div>
    );
  }

  // Not logged in - need to login/register first
  if (!user) {
    // Store the invite path so we can redirect back after login
    const currentPath = `/join/${token}`;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <Users className="h-16 w-16 text-primary mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Ftesë për ekipin</h2>
          <p className="text-muted-foreground mb-2">
            Je ftuar të bashkohesh me ekipin <strong>{teamName}</strong>
          </p>
          <div className="flex items-center justify-center gap-2 mb-6">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Roli: {invite?.role}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Duhet të hysh ose të regjistrohesh para se të pranosh ftesën.
          </p>
          <div className="space-y-3">
            <Link to={`/login?redirect=${encodeURIComponent(currentPath)}`} className="block">
              <Button className="w-full">Hyr në llogari</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Logged in, show invite details with accept button
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full p-8">
        <div className="text-center mb-6">
          <Users className="h-16 w-16 text-primary mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Ftesë për ekipin</h2>
          <p className="text-muted-foreground">
            Je ftuar të bashkohesh me ekipin <strong>{teamName}</strong>
          </p>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="text-sm text-muted-foreground">Roli</span>
            <Badge variant="secondary">{invite?.role}</Badge>
          </div>
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm font-medium">{invite?.email}</span>
          </div>

          {/* Permission summary */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground mb-2">Akses në module:</p>
            <div className="flex flex-wrap gap-1">
              {invite?.canAccessProjects && <Badge variant="outline" className="text-xs">Projektet</Badge>}
              {invite?.canAccessTasks && <Badge variant="outline" className="text-xs">Detyrat</Badge>}
              {invite?.canAccessCRM && <Badge variant="outline" className="text-xs">CRM</Badge>}
              {invite?.canAccessInvoices && <Badge variant="outline" className="text-xs">Faturat</Badge>}
              {invite?.canAccessReports && <Badge variant="outline" className="text-xs">Raportet</Badge>}
              {invite?.canAccessSettings && <Badge variant="outline" className="text-xs">Cilësimet</Badge>}
              {invite?.role === 'Admin' && <Badge variant="outline" className="text-xs">Akses i plotë</Badge>}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            onClick={handleAccept}
            disabled={accepting}
            className="w-full"
          >
            {accepting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Duke pranuar...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Prano Ftesën
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/app/profile')}
            className="w-full"
          >
            Anulo
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default JoinInviteView;
