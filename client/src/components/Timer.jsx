import React, { useState, useEffect } from 'react';

export default function Timer({ expiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    function tick() {
      const diff = Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000));
      setRemaining(diff);
      if (diff === 0) {
        clearInterval(id);
        if (onExpire) onExpire();
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');
  const isLow = remaining > 0 && remaining <= 120;
  const isDone = remaining === 0;

  return (
    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-2xl font-bold
      ${isDone ? 'bg-red-100 text-red-700' : isLow ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-800'}`}>
      <span aria-hidden="true">{isLow || isDone ? '⚠️' : '⏱'}</span>
      <span>{mins}:{secs}</span>
    </div>
  );
}
