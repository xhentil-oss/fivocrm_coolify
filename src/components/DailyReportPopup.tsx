import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection } from '../hooks/useFirestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { useMyServiceLine } from './DepartmentReportFields';
import DailyReportForm, {
  getTodayString,
  dailyDueAt,
  isReportingDay,
  DAILY_PROMPT_HOUR,
  DAILY_PROMPT_MINUTE,
  DAILY_DUE_HOUR,
  DAILY_DUE_MINUTE,
} from './DailyReportForm';
import type { DailyReport } from '../types';

const DUE_LABEL = `${DAILY_DUE_HOUR}:${String(DAILY_DUE_MINUTE).padStart(2, '0')}`;

/**
 * Other surfaces (e.g. "Detyrat e mia") open THIS dialog instead of mounting a
 * second copy of the form ("One form, two mounts" — the popup and the admin
 * preview are the only mounts). The popup is mounted once in the app shell.
 */
export const DAILY_REPORT_OPEN_EVENT = 'fivocrm:open-daily-report';
export function openDailyReport(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DAILY_REPORT_OPEN_EVENT));
}

/**
 * The end-of-day report gate.
 *
 * Owns the SCHEDULE and the two ways of asking — the dialog and, once it is dismissed,
 * a banner that does not go away. The questions themselves live in `DailyReportForm`,
 * which the admin preview renders too, so the two can never drift apart.
 *
 * There is deliberately no "Më vonë" any more. The old button wrote the date into
 * localStorage and silenced the report until the next day, which is why a mandatory
 * daily report was in practice optional: one click and nobody — not the person, not
 * their manager, not the dashboard — was told anything. Closing the dialog now only
 * gets it out of the way; the banner stays, and the server escalates after the
 * deadline whether or not the browser is open.
 */
const DailyReportPopup: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [open, setOpen] = useState(false);
  const [promptTime, setPromptTime] = useState(false);
  const [overdue, setOverdue] = useState(false);

  const serviceLine = useMyServiceLine();
  const today = getTodayString();

  const { data: todayReports } = useCollection<DailyReport>('dailyReports', {
    where: [
      { field: 'userId', operator: '==', value: user?.uid || '__never__' },
      { field: 'date', operator: '==', value: today },
    ],
    skip: !user,
  });

  const alreadySubmitted = useMemo(() => (todayReports?.length || 0) > 0, [todayReports]);

  // An explicit ask from another surface opens the dialog at any hour.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(DAILY_REPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(DAILY_REPORT_OPEN_EVENT, onOpen);
  }, []);

  // One timer for both surfaces. `promptTime` opens the dialog once; after that the
  // banner is driven by the same flag, so closing the dialog cannot hide the ask.
  useEffect(() => {
    if (!user || !permissions.teamId) return;

    let openedOnce = false;

    const check = () => {
      const now = new Date();
      if (!isReportingDay(now)) { setPromptTime(false); return; }

      const past = now.getHours() > DAILY_PROMPT_HOUR
        || (now.getHours() === DAILY_PROMPT_HOUR && now.getMinutes() >= DAILY_PROMPT_MINUTE);

      setPromptTime(past);
      setOverdue(now.getTime() > dailyDueAt(now).getTime());

      if (past && !openedOnce && !alreadySubmitted) {
        openedOnce = true;
        setOpen(true);
      }
    };

    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [user, permissions.teamId, alreadySubmitted]);

  if (!user || !permissions.teamId || alreadySubmitted) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Raporti Ditor
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {overdue
                ? `Afati ishte ${DUE_LABEL}. Plotësoje tani — menaxheri njoftohet për raportet që mungojnë.`
                : `Plotëso raportin e ditës. Afati sot: ${DUE_LABEL}.`}
            </p>
          </DialogHeader>

          <DailyReportForm
            targetUserId={user.uid}
            serviceLine={serviceLine}
            onSubmitted={() => setOpen(false)}
            secondaryAction={
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Mbylle për tani
              </Button>
            }
          />
        </DialogContent>
      </Dialog>

      {/* The ask that does not go away. */}
      {promptTime && !open && (
        <div className="fixed inset-x-3 bottom-20 sm:inset-x-auto sm:right-4 sm:bottom-4 z-40 sm:max-w-sm">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`w-full text-left rounded-lg border shadow-lg px-3.5 py-2.5 flex items-center gap-2.5 transition-colors ${
              overdue
                ? 'bg-error text-white border-error hover:bg-error/90'
                : 'bg-warning/95 text-white border-warning hover:bg-warning'
            }`}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm flex-1">
              <span className="font-medium block">Raporti i sotëm nuk është dorëzuar</span>
              <span className="text-xs opacity-90">
                {overdue ? `Afati ishte ${DUE_LABEL}` : `Afati sot ${DUE_LABEL}`}
              </span>
            </span>
            <span className="text-xs font-medium underline underline-offset-2">Plotëso</span>
          </button>
        </div>
      )}
    </>
  );
};

export default DailyReportPopup;
