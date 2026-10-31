import React, { useEffect, useMemo, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useTeamSettingsDoc, saveTeamSettings } from './useTeamSettings';
import { toast } from './use-toast';
import { sortByManualOrder, pruneManualOrder, doneLast } from '../lib/taskSort';
import type { Task } from '../types';

/**
 * The Tasks list's MANUAL (drag) order — extracted verbatim from TasksView.
 *
 * The team-shared order lives in teamSettings, which the rules let only an
 * Admin/Manager (or owner / super-admin) write. Everyone else drags into a
 * PERSONAL order kept on this device (permission FLAGS, never role strings).
 */
export function useTaskListOrder(allTasks: Task[], rawTasks: Task[] | undefined | null) {
  const { user } = useAuth();
  const permissions = usePermissions();
  // The settings AND the team they belong to: `settings` resets to null while a
  // new team loads, and `teamId` here is the one the loaded order is for.
  const { settings: teamSettingsData, teamId } = useTeamSettingsDoc();

  const [listOrder, setListOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tasks_list_order') || '[]'); } catch { return []; }
  });
  // The team whose order is currently loaded (`undefined` = nothing loaded yet).
  // A plain "loaded once" boolean never reset, so after a team switch the list
  // kept the OLD team's order until a reload.
  const listOrderLoadedFor = React.useRef<string | undefined>(undefined);
  const canWriteSharedOrder = !!(permissions.isAdmin || permissions.isManager || permissions.isOwner || permissions.isSuperAdmin);
  const personalOrderKey = user?.uid ? `tasks_list_order:${user.uid}` : null;
  const personalOrderNoticeShown = React.useRef(false);
  // Load the order once PER TEAM: a writer gets the shared Firestore order (it
  // takes priority over localStorage); a non-writer gets their own saved order
  // first — otherwise every reload clobbered their drags with the shared one.
  useEffect(() => {
    if (teamSettingsData === null || !teamId || permissions.isLoading) return;
    if (listOrderLoadedFor.current === teamId) return;
    const isTeamSwitch = listOrderLoadedFor.current !== undefined;
    listOrderLoadedFor.current = teamId;
    if (!canWriteSharedOrder && personalOrderKey) {
      try {
        const own = JSON.parse(localStorage.getItem(personalOrderKey) || 'null');
        if (Array.isArray(own) && own.length > 0) { setListOrder(own); return; }
      } catch { /* unreadable → fall back to the shared order */ }
    }
    if (teamSettingsData.taskListOrder && teamSettingsData.taskListOrder.length > 0) {
      setListOrder(teamSettingsData.taskListOrder);
      return;
    }
    // The new team has no saved order: drop the previous team's, or its drag
    // order would silently apply to this team's tasks. (First load keeps the
    // localStorage copy, exactly as before.)
    if (isTeamSwitch) setListOrder([]);
  }, [teamSettingsData, teamId, permissions.isLoading, canWriteSharedOrder, personalOrderKey]);

  // Shared manual-order map (used by both the list view and board columns).
  const orderMap = useMemo(() => new Map(listOrder.map((id, i) => [id, i])), [listOrder]);
  // Tasks created AFTER the last drag are not in the map: they stay on top in
  // their `createdAt desc` order (src/lib/taskSort.ts). The old 99999 sentinel
  // sank every new task below all ordered ones — onto the last page.
  // Completed tasks always go below the open ones (a no-op inside a board column).
  const sortByOrder = React.useCallback((arr: Task[]) => doneLast(sortByManualOrder(arr, orderMap)), [orderMap]);

  // Reorder against the FULL workspace task list (not just the filtered/paginated
  // subset), so a manual move while a filter or search is active doesn't drop the
  // order of every hidden task to the end.
  const applyReorder = async (taskId: string, overId: string) => {
    // Start from the MANUAL order (unknown ids first — see taskSort), not
    // "saved order + unknown appended": with a fresh task at the top, a row
    // dropped onto it landed at the bottom of the saved order, i.e. last page.
    // Deliberately WITHOUT doneLast: "Done sinks" is a display rule. Baking it
    // into the saved (team-shared) order moved every completed task to the end
    // for good, so re-opening one never brought it back to its slot.
    const full = sortByManualOrder(allTasks, orderMap).map(t => t.id);
    // Indexed once: `full.includes` inside the loop was O(order × tasks) per drop.
    const present = new Set(full);
    for (const id of listOrder) if (!present.has(id)) { present.add(id); full.push(id); }
    const oldIndex = full.indexOf(taskId);
    const newIndex = full.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    // Drop ids of deleted tasks — the saved order only ever grew. Pruned against
    // the WORKSPACE list: the role-filtered one would erase the slots of every
    // task this user cannot see from an order the whole team shares.
    const reordered = pruneManualOrder(arrayMove(full, oldIndex, newIndex), rawTasks || allTasks);
    setListOrder(reordered);
    if (!canWriteSharedOrder || !teamId) {
      // teamSettings is Admin/Manager-only in the rules: everyone else keeps a
      // personal order on this device (the write used to be rejected silently).
      try { if (personalOrderKey) localStorage.setItem(personalOrderKey, JSON.stringify(reordered)); } catch { /* storage unavailable */ }
      if (!personalOrderNoticeShown.current) {
        personalOrderNoticeShown.current = true;
        toast({ title: 'Renditja u ruajt vetëm për ty', description: 'Renditja e përbashkët e ekipit ndryshohet nga administratori ose menaxheri.' });
      }
      return;
    }
    try { localStorage.setItem('tasks_list_order', JSON.stringify(reordered)); } catch { /* storage unavailable */ }
    try {
      await saveTeamSettings(teamId, { taskListOrder: reordered });
    } catch (err: any) {
      console.error('[Tasks] ruajtja e renditjes dështoi:', err);
      toast({ title: 'Renditja nuk u ruajt për ekipin', description: err?.message, variant: 'destructive' });
    }
  };

  return { sortByOrder, applyReorder };
}
