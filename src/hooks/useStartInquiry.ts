import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useClientPortal } from './useClientPortal';
import { useCollection } from './useFirestore';
import { useToast } from './use-toast';
import type { Service } from '../types';

/**
 * Burim i VETËM për nisjen e një brief-i të projektit nga portali.
 *
 * Krijon një dokument `serviceInquiries` në gjendjen 'Draft' (kështu shfaqet
 * menjëherë te tab-i Projektet me statusin "Draft · Brief në plotësim") dhe të
 * çon te faqja e formularit: /portal/projects/inquiry/:id
 *
 * Ripërdoret nga:
 *  - Projektet ("Nis një projekt të ri") — pa shërbim paraprak.
 *  - Shërbimet ("Kërko Shërbim" / "Kërko këtë shërbim") — me shërbimin e zgjedhur.
 */
export function useStartInquiry() {
  const { user } = useAuth();
  const { customerId, businessId } = useClientPortal();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Resolve a teamId for portal users (they have no getGlobalTeamId()).
  const { data: activeTeamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });
  const resolvedTeamId = activeTeamMembers?.find((m: any) => m.teamId)?.teamId || null;

  return useCallback(async (service?: Service) => {
    try {
      const ref = await addDoc(collection(db, 'serviceInquiries'), {
        status: 'Draft',
        isDraft: true,
        lastSavedStep: 1,
        customerId: customerId || undefined,
        clientUserId: user?.uid || undefined,
        // Seed the service from the catalog card so the form is pre-filled.
        servicesInterestedIn: service?.category ? [service.category] : [],
        serviceTitle: service?.title || service?.name || 'Brief-i i projektit',
        businessName: user?.displayName || '',
        contactName: user?.displayName || '',
        email: user?.email || '',
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        // Stamp the tenant so the inquiry falls inside the admin's business-scoped
        // queries (otherwise it is invisible in the staff Service Inquiries list).
        ...(businessId ? { businessId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user?.uid || null,
      });
      navigate(`/portal/projects/inquiry/${ref.id}`);
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u krijua dot brief-i. Provoni përsëri.', variant: 'destructive' });
    }
  }, [customerId, businessId, user, resolvedTeamId, navigate, toast]);
}

export default useStartInquiry;
