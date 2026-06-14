import React from 'react';

export default function FlaggedRecord({ record }) {
  return (
    <tr className="hover:bg-red-50 transition">
      <td className="px-4 py-3 font-mono text-sm">{record.student_id}</td>
      <td className="px-4 py-3 text-sm">{record.center_id}</td>
      <td className="px-4 py-3 text-sm">{record.invigilator_name || '—'}</td>
      <td className="px-4 py-3 font-mono text-xs text-gray-500">{(record.edge_hash || '').slice(0, 8)}…</td>
      <td className="px-4 py-3 font-mono text-xs text-gray-500">{(record.hub_hash || '').slice(0, 8)}…</td>
      <td className="px-4 py-3 text-xs text-red-700">{record.mismatch_detail}</td>
      <td className="px-4 py-3 text-xs text-gray-400">{record.flagged_at ? new Date(record.flagged_at).toLocaleString() : '—'}</td>
      <td className="px-4 py-3">
        <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded-full">FLAGGED</span>
      </td>
    </tr>
  );
}
