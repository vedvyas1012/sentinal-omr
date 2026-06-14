import React from 'react';

export default function ScanResult({ record }) {
  return (
    <div className="bg-white border border-green-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-gray-800">Student: {record.student_id}</span>
        <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full">
          ✓ Verified
        </span>
      </div>
      <div className="text-xs text-gray-500 font-mono break-all mb-1">
        <span className="font-semibold text-gray-600">Data: </span>{record.raw_data_string || record.dataString}
      </div>
      <div className="text-xs text-gray-500 font-mono">
        <span className="font-semibold text-gray-600">Hash: </span>
        {(record.edge_hash || record.edgeHash || '').slice(0, 12)}...
      </div>
      {record.scanned_at && (
        <div className="text-xs text-gray-400 mt-1">
          {new Date(record.scanned_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
