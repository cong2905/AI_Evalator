import { useEffect, useRef, useState } from 'react';

/**
 * Counts down to 0 in whole seconds. Used for the Groq rate limit, where the
 * Evaluate button has to stay disabled until the wait is over.
 */
export function useCountdown(): { secondsLeft: number; start: (seconds: number) => void } {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (secondsLeft <= 0) return;

    timerRef.current = window.setTimeout(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timerRef.current);
  }, [secondsLeft]);

  return {
    secondsLeft,
    start: (seconds: number) => setSecondsLeft(Math.max(0, Math.ceil(seconds))),
  };
}
