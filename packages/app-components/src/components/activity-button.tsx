import { useTasks } from "@osmix/app-core";
import { Button, StatusDot } from "@osmix/ui";
import { useAtomValue, useSetAtom } from "jotai";
import { ListTreeIcon } from "lucide-react";

import {
  acknowledgedErrorIdAtom,
  activitySheetOpenAtom,
  latestErrorId,
} from "../state/activity.ts";

/**
 * The nav's last item: opens the Activity sheet. Running work shows in task toasts, not here;
 * the button only carries an error dot until the newest failure is seen (the sheet opened, or
 * its toast dismissed).
 */
export function ActivityButton() {
  const { entries } = useTasks();
  const acknowledged = useAtomValue(acknowledgedErrorIdAtom);
  const setSheetOpen = useSetAtom(activitySheetOpenAtom);
  const errorId = latestErrorId(entries);
  const unseenError = errorId !== null && errorId !== acknowledged;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={unseenError ? "Activity, new error" : "Activity"}
      onClick={() => setSheetOpen(true)}
    >
      <span className="relative flex">
        <ListTreeIcon aria-hidden="true" />
        {unseenError ? <StatusDot status="error" className="absolute -top-0.5 -right-0.5" /> : null}
      </span>
      <span>Activity</span>
    </Button>
  );
}
