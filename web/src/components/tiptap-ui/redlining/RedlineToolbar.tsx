import React from 'react'

export type ViewMode = 'full-redline' | 'counterparty-only' | 'final'

interface RedlineToolbarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  trackingEnabled: boolean
  onToggleTracking: (enabled: boolean) => void
}

export const RedlineToolbar: React.FC<RedlineToolbarProps> = ({
  viewMode,
  onViewModeChange,
  trackingEnabled,
  onToggleTracking,
}) => {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-300">
      {/* Track Changes Toggle */}
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 font-medium">
          <input
            type="checkbox"
            checked={trackingEnabled}
            onChange={(e) => onToggleTracking(e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
          />
          <span>Track Changes</span>
        </label>
        <span className={`h-2 w-2 rounded-full ${trackingEnabled ? 'bg-green-500' : 'bg-slate-500'}`} />
      </div>

      {/* View Selector */}
      <div className="flex items-center gap-1 rounded-md bg-slate-800 p-1">
        <button
          onClick={() => onViewModeChange('full-redline')}
          className={`rounded px-2.5 py-1 font-medium transition-colors ${
            viewMode === 'full-redline' ? 'bg-slate-700 text-white shadow-sm' : 'hover:text-white'
          }`}
        >
          All Redlines
        </button>

        <button
          onClick={() => onViewModeChange('counterparty-only')}
          className={`rounded px-2.5 py-1 font-medium transition-colors ${
            viewMode === 'counterparty-only' ? 'bg-slate-700 text-white shadow-sm' : 'hover:text-white'
          }`}
        >
          Counterparty Edits
        </button>

        <button
          onClick={() => onViewModeChange('final')}
          className={`rounded px-2.5 py-1 font-medium transition-colors ${
            viewMode === 'final' ? 'bg-slate-700 text-white shadow-sm' : 'hover:text-white'
          }`}
        >
          Final Clean
        </button>
      </div>
    </div>
  )
}