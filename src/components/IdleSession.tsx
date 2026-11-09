import { useEffect, useRef, useState } from "react";
import { startIdleSession } from "@/lib/idle-session";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function IdleSession({ userId, onExpire }: { userId: string; onExpire: () => void }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const controller = useRef<ReturnType<typeof startIdleSession> | null>(null);
  useEffect(() => {
    controller.current = startIdleSession(userId, setSeconds, onExpire);
    return () => { controller.current?.stop(); controller.current = null; };
  }, [userId, onExpire]);
  return (
    <AlertDialog open={seconds !== null}>
      <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Your session is about to end</AlertDialogTitle>
          <AlertDialogDescription>You’ll be signed out in {seconds ?? 0} seconds because of inactivity.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={() => controller.current?.staySignedIn()}>Stay signed in</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}