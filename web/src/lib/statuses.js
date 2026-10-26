export const STATUSES = ['unstarted', 'started', 'stopped', 'completed', 'finished']

export const COLUMNS = [
  { status: 'unstarted', label: 'Unstarted' },
  { status: 'started', label: 'Started' },
  { status: 'stopped', label: 'Stopped' },
  { status: 'completed', label: 'Completed' },
  { status: 'finished', label: 'Finished' },
]

// Status colors are design tokens (--status-* in index.css); these map them to classes.
export const statusDot = {
  unstarted: 'bg-status-unstarted',
  started: 'bg-status-started',
  stopped: 'bg-status-stopped',
  completed: 'bg-status-completed',
  finished: 'bg-status-finished',
}

export const statusBadge = {
  unstarted: 'border-status-unstarted/40 text-status-unstarted',
  started: 'border-status-started/40 text-status-started',
  stopped: 'border-status-stopped/40 text-status-stopped',
  completed: 'border-status-completed/40 text-status-completed',
  finished: 'border-status-finished/40 text-status-finished',
}

export const statusPill = {
  unstarted: 'bg-status-unstarted/12 text-status-unstarted',
  started: 'bg-status-started/12 text-status-started',
  stopped: 'bg-status-stopped/12 text-status-stopped',
  completed: 'bg-status-completed/12 text-status-completed',
  finished: 'bg-status-finished/12 text-status-finished',
}
