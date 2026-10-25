export const STATUSES = ['unstarted', 'started', 'stopped', 'completed', 'finished']

export const COLUMNS = [
  { status: 'unstarted', label: 'Unstarted' },
  { status: 'started', label: 'Started' },
  { status: 'stopped', label: 'Stopped' },
  { status: 'completed', label: 'Completed' },
  { status: 'finished', label: 'Finished' },
]

// Accent classes per status, used for column dots and status badges.
export const statusDot = {
  unstarted: 'bg-zinc-400',
  started: 'bg-blue-400',
  stopped: 'bg-yellow-400',
  completed: 'bg-green-400',
  finished: 'bg-purple-400',
}

export const statusBadge = {
  unstarted: 'border-zinc-500/40 text-zinc-400',
  started: 'border-blue-400/40 text-blue-400',
  stopped: 'border-yellow-400/40 text-yellow-400',
  completed: 'border-green-400/40 text-green-400',
  finished: 'border-purple-400/40 text-purple-400',
}
